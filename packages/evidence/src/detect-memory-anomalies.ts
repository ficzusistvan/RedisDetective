import type {
  AnomalyEvent,
  AnomalyKind,
  AnomalyMetric,
  RedisSnapshot,
} from '@redis-detective/core-types';

import type { ResolvedEvidenceOptions } from './evidence-options.js';
import type { GrowthMetric } from './select-growth-metric.js';
import { createEvidenceId } from './create-evidence-id.js';
import { describeChange } from './describe-change.js';
import { gradeEvidenceStrength } from './grade-evidence-strength.js';
import { comparableStoredBytes, selectGrowthMetric } from './select-growth-metric.js';
import { relativeChange } from './relative-change.js';
import { totalKeyCount } from './total-key-count.js';

/**
 * Memory counters come from `INFO`, which is measured rather than sampled, so the key sample's
 * thinness does not bear on whether the number moved.
 */
const MEASURED_SAMPLE_RATE = 1;

/** An anomaly always accounts for the whole of the change it describes. */
const WHOLE_OF_CHANGE = 1;

/** Three snapshots is the minimum that distinguishes a sustained trend from a single jump. */
const MIN_RUN_FOR_TREND = 3;

interface AnomalyDraft {
  readonly kind: AnomalyKind;
  readonly metric: AnomalyMetric;
  readonly before: RedisSnapshot;
  readonly after: RedisSnapshot;
  readonly valueBefore: number;
  readonly valueAfter: number;
  readonly deltaBytes: number | null;
  readonly supportingSnapshotCount: number;
  readonly hasCorroboratingSignal: boolean;
  readonly observations: readonly string[];
}

function finalize(draft: AnomalyDraft, span: readonly RedisSnapshot[]): AnomalyEvent {
  return {
    eventId: createEvidenceId('anomaly', [
      draft.kind,
      draft.metric,
      draft.before.snapshotId,
      draft.after.snapshotId,
    ]),
    kind: draft.kind,
    metric: draft.metric,
    window: { from: draft.before.capturedAt, to: draft.after.capturedAt },
    valueBefore: draft.valueBefore,
    valueAfter: draft.valueAfter,
    deltaBytes: draft.deltaBytes,
    snapshotIdBefore: draft.before.snapshotId,
    snapshotIdAfter: draft.after.snapshotId,
    evidenceStrength: gradeEvidenceStrength({
      supportingSnapshotCount: draft.supportingSnapshotCount,
      effectiveSampleRate: MEASURED_SAMPLE_RATE,
      shareOfGrowth: WHOLE_OF_CHANGE,
      sampleTruncated: span.some((snapshot) => snapshot.sampling.truncated),
      hasCorroboratingSignal: draft.hasCorroboratingSignal,
    }),
    observations: draft.observations,
  };
}

function gapMs(before: RedisSnapshot, after: RedisSnapshot): number {
  return Date.parse(after.capturedAt) - Date.parse(before.capturedAt);
}

interface Interval {
  readonly before: RedisSnapshot;
  readonly after: RedisSnapshot;
  /** Index of `before` in the sorted snapshot list. */
  readonly index: number;
}

/**
 * Consecutive pairs close enough in time to reason about.
 *
 * An interval longer than `maxSnapshotGapMs` is dropped rather than analysed: the change could have
 * happened anywhere inside it, so calling it a step change would put a deploy-shaped label on
 * something that might have been a week of slow drift. `buildEvidenceGraph` records the dropped
 * interval as a `snapshot-gap`, so the omission is visible instead of silent.
 */
function comparableIntervals(
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): readonly Interval[] {
  const intervals: Interval[] = [];

  for (let index = 0; index + 1 < snapshots.length; index += 1) {
    const before = snapshots[index];
    const after = snapshots[index + 1];
    if (before === undefined || after === undefined) {
      continue;
    }
    if (gapMs(before, after) > options.maxSnapshotGapMs) {
      continue;
    }
    intervals.push({ before, after, index });
  }

  return intervals;
}

function detectStepChange(
  interval: Interval,
  metric: GrowthMetric,
  options: ResolvedEvidenceOptions,
): AnomalyEvent | null {
  const valueBefore = comparableStoredBytes(interval.before, metric);
  const valueAfter = comparableStoredBytes(interval.after, metric);
  // A missing counter, or a resident 0 beside a non-empty keyspace, is not stored size.
  if (valueBefore === null || valueAfter === null) {
    return null;
  }
  const delta = valueAfter - valueBefore;

  // Both thresholds, not either. 8 MiB on a 100 GiB instance is routine churn, and 2% of a 4 MiB
  // instance is still under the absolute floor. Requiring both is what the two bars are for.
  // This interval is a step because the change happened in one comparable interval. A run that
  // rises at every snapshot is a trend, and it uses this same pair — not a harsher percentage.
  if (
    delta < options.minGrowthBytes ||
    relativeChange(valueBefore, valueAfter) < options.minGrowthRatio
  ) {
    return null;
  }

  const keysBefore = totalKeyCount(interval.before);
  const keysAfter = totalKeyCount(interval.after);

  return finalize(
    {
      kind: 'memory-step-change',
      metric,
      before: interval.before,
      after: interval.after,
      valueBefore,
      valueAfter,
      deltaBytes: delta,
      supportingSnapshotCount: 2,
      // A jump in bytes matched by a jump in keys is a write path producing more data, rather than
      // a transient buffer or a background save inflating one reading.
      hasCorroboratingSignal: relativeChange(keysBefore, keysAfter) >= options.minGrowthRatio,
      observations: [
        describeChange(metric, valueBefore, valueAfter, 'bytes'),
        describeChange('key count', keysBefore, keysAfter, 'keys'),
        `Change occurred within a single ${gapMs(interval.before, interval.after)}ms interval, so it is a step rather than a trend.`,
      ],
    },
    [interval.before, interval.after],
  );
}

function detectKeyCountGrowth(
  run: readonly RedisSnapshot[],
  metric: GrowthMetric,
  options: ResolvedEvidenceOptions,
): AnomalyEvent | null {
  const first = run[0];
  const last = run[run.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }

  const keysBefore = totalKeyCount(first);
  const keysAfter = totalKeyCount(last);
  const keyGrowth = relativeChange(keysBefore, keysAfter);
  const memoryBefore = comparableStoredBytes(first, metric);
  const memoryAfter = comparableStoredBytes(last, metric);
  // "Faster than memory" needs a stored-size reading at both ends. A resident zero is not one.
  if (memoryBefore === null || memoryAfter === null) {
    return null;
  }
  const memoryGrowth = relativeChange(memoryBefore, memoryAfter);

  // Keys outpacing bytes means the instance is accumulating entries rather than fattening existing
  // ones — the shape a leak of small keys makes, and a different fix from a value that grew.
  if (keyGrowth < options.minGrowthRatio || keyGrowth <= memoryGrowth) {
    return null;
  }

  return finalize(
    {
      kind: 'key-count-growth',
      metric: 'key_count',
      before: first,
      after: last,
      valueBefore: keysBefore,
      valueAfter: keysAfter,
      // Not a byte figure: this metric counts keys.
      deltaBytes: null,
      supportingSnapshotCount: run.length,
      hasCorroboratingSignal: memoryGrowth > 0,
      observations: [
        describeChange('key count', keysBefore, keysAfter, 'keys'),
        `Key count rose faster than ${metric}, so the instance is accumulating keys rather than storing larger values.`,
      ],
    },
    run,
  );
}

function detectFragmentationGrowth(
  run: readonly RedisSnapshot[],
  metric: GrowthMetric,
  options: ResolvedEvidenceOptions,
): AnomalyEvent | null {
  const first = run[0];
  const last = run[run.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }

  const ratioBefore = first.memory.memFragmentationRatio;
  const ratioAfter = last.memory.memFragmentationRatio;
  const storedBefore = comparableStoredBytes(first, metric);
  const storedAfter = comparableStoredBytes(last, metric);
  // "Stored data was flat" is only sayable when both ends have a stored-size reading.
  if (storedBefore === null || storedAfter === null) {
    return null;
  }
  const datasetGrowth = relativeChange(storedBefore, storedAfter);

  // Only interesting while the data itself is flat. Fragmentation rising alongside real growth is
  // ordinary allocator behaviour and would distract from the actual cause.
  if (
    relativeChange(ratioBefore, ratioAfter) < options.minGrowthRatio ||
    datasetGrowth >= options.minGrowthRatio
  ) {
    return null;
  }

  const rssBefore = first.memory.usedMemoryRssBytes;
  const rssAfter = last.memory.usedMemoryRssBytes;
  const rssObservations =
    rssBefore === null || rssAfter === null
      ? []
      : [describeChange('used_memory_rss', rssBefore, rssAfter, 'bytes')];

  return finalize(
    {
      kind: 'fragmentation-growth',
      metric: 'mem_fragmentation_ratio',
      before: first,
      after: last,
      valueBefore: ratioBefore,
      valueAfter: ratioAfter,
      // A ratio, not a byte count.
      deltaBytes: null,
      supportingSnapshotCount: run.length,
      hasCorroboratingSignal:
        rssBefore !== null &&
        rssAfter !== null &&
        relativeChange(rssBefore, rssAfter) >= options.minGrowthRatio,
      observations: [
        describeChange('mem_fragmentation_ratio', ratioBefore, ratioAfter, 'ratio'),
        ...rssObservations,
        `Stored data was flat across this window (${metric} changed by less than the ${options.minGrowthRatio} growth threshold), so the additional footprint is allocator overhead rather than new data.`,
      ],
    },
    run,
  );
}

function detectEvictionOnset(interval: Interval): AnomalyEvent | null {
  const before = interval.before.memory.evictedKeys;
  const after = interval.after.memory.evictedKeys;

  // Zero to non-zero only. A rising eviction count on an instance that was already evicting is not
  // an onset, and reporting it every interval would bury the moment it actually started.
  if (before !== 0 || after <= 0) {
    return null;
  }

  const { maxmemoryBytes, maxmemoryPolicy } = interval.after.instance;
  const used = interval.after.memory.usedMemoryBytes;

  return finalize(
    {
      kind: 'eviction-onset',
      metric: 'evicted_keys',
      before: interval.before,
      after: interval.after,
      valueBefore: before,
      valueAfter: after,
      // A key count, not bytes.
      deltaBytes: null,
      supportingSnapshotCount: 2,
      hasCorroboratingSignal:
        maxmemoryBytes !== null && used !== null && used >= maxmemoryBytes * 0.9,
      observations: [
        describeChange('evicted_keys', before, after, 'keys'),
        `Evictions began under the ${maxmemoryPolicy} policy, so the instance reached its ceiling during this interval and is discarding data.`,
        used === null
          ? 'used_memory was not reported, so it cannot be compared with maxmemory.'
          : maxmemoryBytes === null
            ? 'No maxmemory is configured on this instance, so the ceiling is the host.'
            : `used_memory was ${used} bytes against a maxmemory of ${maxmemoryBytes} bytes.`,
      ],
    },
    [interval.before, interval.after],
  );
}

/**
 * Maximal runs of consecutive snapshots over which `valueOf` strictly rises.
 *
 * *Maximal* is the important word. Reporting every sub-interval of a four-hour rise as its own
 * anomaly would produce three findings, three attributions and three paragraphs all describing the
 * same phenomenon, so a reader would have to work out for themselves that they were looking at one
 * problem counted repeatedly. One anomaly per span, spanning as far as the metric keeps rising.
 *
 * Runs are built from the interval list rather than from the snapshot list, so a dropped (over-long)
 * interval breaks the run instead of being silently bridged across unobserved time.
 */
function risingRuns(
  intervals: readonly Interval[],
  valueOf: (snapshot: RedisSnapshot) => number,
  minLength: number,
): readonly (readonly RedisSnapshot[])[] {
  const runs: (readonly RedisSnapshot[])[] = [];
  let current: RedisSnapshot[] = [];

  const flush = (): void => {
    if (current.length >= minLength) {
      runs.push(current);
    }
    current = [];
  };

  for (const interval of intervals) {
    // Non-finite readings are not a rise. `<=` would treat NaN as a rise because every comparison
    // with NaN is false.
    if (!(valueOf(interval.after) > valueOf(interval.before))) {
      flush();
      continue;
    }

    const contiguous =
      current.length > 0 && current[current.length - 1]?.snapshotId === interval.before.snapshotId;

    if (contiguous) {
      current.push(interval.after);
    } else {
      flush();
      current = [interval.before, interval.after];
    }
  }

  flush();

  return runs;
}

/** Interval indexes whose endpoints are adjacent snapshots inside `run`. */
function indexesCoveredByRun(
  run: readonly RedisSnapshot[],
  intervals: readonly Interval[],
): readonly number[] {
  const position = new Map(run.map((snapshot, index) => [snapshot.snapshotId, index]));
  const covered: number[] = [];
  for (const interval of intervals) {
    const before = position.get(interval.before.snapshotId);
    const after = position.get(interval.after.snapshotId);
    if (before !== undefined && after !== undefined && after === before + 1) {
      covered.push(interval.index);
    }
  }
  return covered;
}

function detectSustainedGrowth(
  run: readonly RedisSnapshot[],
  metric: GrowthMetric,
  options: ResolvedEvidenceOptions,
): AnomalyEvent | null {
  const first = run[0];
  const last = run[run.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }

  const valueBefore = comparableStoredBytes(first, metric);
  const valueAfter = comparableStoredBytes(last, metric);
  if (valueBefore === null || valueAfter === null) {
    return null;
  }
  const delta = valueAfter - valueBefore;

  // Same pair as a step: at least minGrowthBytes and at least minGrowthRatio of the starting
  // stored size. The finding is a trend because stored size rose at every snapshot in the run,
  // not because its percentage cleared a lower bar than a step's.
  if (
    delta < options.minGrowthBytes ||
    relativeChange(valueBefore, valueAfter) < options.minGrowthRatio
  ) {
    return null;
  }

  const keysBefore = totalKeyCount(first);
  const keysAfter = totalKeyCount(last);

  return finalize(
    {
      kind: 'memory-growth',
      metric,
      before: first,
      after: last,
      valueBefore,
      valueAfter,
      deltaBytes: delta,
      supportingSnapshotCount: run.length,
      hasCorroboratingSignal: relativeChange(keysBefore, keysAfter) >= options.minGrowthRatio,
      observations: [
        describeChange(metric, valueBefore, valueAfter, 'bytes'),
        describeChange('key count', keysBefore, keysAfter, 'keys'),
        `${metric} rose in every one of the ${run.length - 1} intervals between ${run.length} consecutive snapshots, so this is a sustained trend rather than a single jump.`,
      ],
    },
    run,
  );
}

/**
 * Finds the intervals in which something measurably changed.
 *
 * Answers "what changed and when", never "why" — attribution is a separate step, and keeping the
 * two apart is what lets us report growth we cannot explain instead of inventing an explanation
 * for it.
 *
 * Pure and offline: no clock, no randomness, no I/O. The same snapshots must always produce the
 * same anomalies in the same order.
 *
 * A rising run of at least three snapshots is one memory-growth finding. A single comparable
 * interval that is not part of such a run is a memory-step-change. Both use the same byte and
 * ratio thresholds; the kind is the shape, so the same bytes are not described twice. Anomalies
 * on other metrics (`key_count`, `mem_fragmentation_ratio`, `evicted_keys`) are different
 * observations about the same interval and can legitimately coexist with a memory one.
 */
export function detectMemoryAnomalies(
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): readonly AnomalyEvent[] {
  if (snapshots.length < 2) {
    return [];
  }

  const metric = selectGrowthMetric(snapshots);
  const intervals = comparableIntervals(snapshots, options);
  // Resident zeros and missing counters stay on the snapshot, but they are not stored-size points,
  // so memory trends are built from the readings that still describe how much data is stored.
  const memoryIntervals = comparableIntervals(
    snapshots.filter((snapshot) => comparableStoredBytes(snapshot, metric) !== null),
    options,
  );
  const anomalies: AnomalyEvent[] = [];
  const trendIndexes = new Set<number>();

  // Shape first. A run that rises at every snapshot is one trend, even when an interval inside it
  // would also clear the shared thresholds. Those intervals are not also reported as steps.
  for (const run of risingRuns(
    memoryIntervals,
    (snapshot) => comparableStoredBytes(snapshot, metric) ?? Number.NaN,
    MIN_RUN_FOR_TREND,
  )) {
    const sustained = detectSustainedGrowth(run, metric, options);
    if (sustained === null) {
      continue;
    }
    anomalies.push(sustained);
    for (const index of indexesCoveredByRun(run, memoryIntervals)) {
      trendIndexes.add(index);
    }
  }

  // A step is one comparable interval that is not already inside a trend. Eviction onset stays on
  // the full list: a resident-zero sample can still be the moment evictions start.
  for (const interval of memoryIntervals) {
    if (trendIndexes.has(interval.index)) {
      continue;
    }
    const stepChange = detectStepChange(interval, metric, options);
    if (stepChange !== null) {
      anomalies.push(stepChange);
    }
  }

  for (const interval of intervals) {
    const evictionOnset = detectEvictionOnset(interval);
    if (evictionOnset !== null) {
      anomalies.push(evictionOnset);
    }
  }

  for (const run of risingRuns(intervals, totalKeyCount, 2)) {
    const keyGrowth = detectKeyCountGrowth(run, metric, options);
    if (keyGrowth !== null) {
      anomalies.push(keyGrowth);
    }
  }

  for (const run of risingRuns(intervals, (snapshot) => snapshot.memory.memFragmentationRatio, 2)) {
    const fragmentation = detectFragmentationGrowth(run, metric, options);
    if (fragmentation !== null) {
      anomalies.push(fragmentation);
    }
  }

  // Stable order regardless of detection order, so the same snapshots always produce the same list.
  return anomalies.sort(
    (left, right) =>
      Date.parse(left.window.from) - Date.parse(right.window.from) ||
      left.metric.localeCompare(right.metric) ||
      left.kind.localeCompare(right.kind) ||
      left.eventId.localeCompare(right.eventId),
  );
}
