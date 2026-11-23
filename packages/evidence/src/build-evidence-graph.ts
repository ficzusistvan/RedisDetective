import type {
  AnomalyEvent,
  AnomalyKind,
  EvidenceGap,
  EvidenceGraph,
  PatternAttribution,
  RedisSnapshot,
  TTLDriftEvent,
  TimeWindow,
} from '@redis-detective/core-types';
import { ANOMALY_METRIC_PHRASE } from '@redis-detective/core-types';

import type { EvidenceOptions, ResolvedEvidenceOptions } from './evidence-options.js';
import { attributeGrowthToPatterns } from './attribute-growth-to-patterns.js';
import { createEvidenceId } from './create-evidence-id.js';
import { describePatternContributors } from './describe-pattern-contributors.js';
import { detectMemoryAnomalies } from './detect-memory-anomalies.js';
import { detectTtlDrift } from './detect-ttl-drift.js';
import { resolveEvidenceOptions } from './evidence-options.js';
import { formatDuration } from './format-duration.js';
import {
  formatBinaryMagnitude,
  formatRatioPercent,
  formatUtcInstant,
} from './format-reported-quantity.js';
import { relativeChange } from './relative-change.js';
import {
  comparableStoredBytes,
  readGrowthMetric,
  selectGrowthMetric,
} from './select-growth-metric.js';
import { sortSnapshotsChronologically } from './sort-snapshots-chronologically.js';
import { totalKeyCount } from './total-key-count.js';

export interface BuildEvidenceGraphInput {
  readonly snapshots: readonly RedisSnapshot[];
  /**
   * ISO-8601 UTC stamp for `EvidenceGraph.builtAt`, supplied by the caller.
   * This package never reads the clock, so that identical snapshots yield identical graphs.
   */
  readonly builtAt: string;
  readonly options?: EvidenceOptions;
}

/**
 * Attributions must together explain at least this much of an anomaly, or the remainder is recorded
 * as unattributed. Half is a deliberately low bar: the point is to admit that a cause is partial,
 * not to withhold a finding that is genuinely useful.
 */
const MIN_EXPLAINED_SHARE = 0.5;

/** Mid-sentence gloss for an anomaly kind. Never emit the kebab-case kind id in gap prose. */
const ANOMALY_KIND_IN_GAP: Record<AnomalyKind, string> = {
  'memory-growth': 'memory growth',
  'memory-step-change': 'memory step change',
  'fragmentation-growth': 'fragmentation growth',
  'key-count-growth': 'key count growth',
  'eviction-onset': 'eviction onset',
};

function anomalyKindInGap(kind: AnomalyKind): string {
  return ANOMALY_KIND_IN_GAP[kind];
}

function windowOf(snapshots: readonly RedisSnapshot[], builtAt: string): TimeWindow {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (first === undefined || last === undefined) {
    // No snapshots at all: the analysis covered no time. Reporting the build stamp for both bounds
    // keeps the field a valid instant rather than an invented span.
    return { from: builtAt, to: builtAt };
  }
  return { from: first.capturedAt, to: last.capturedAt };
}

function sampleGaps(
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): readonly EvidenceGap[] {
  const gaps: EvidenceGap[] = [];

  const thin = snapshots.filter(
    (snapshot) => snapshot.sampling.effectiveSampleRate < options.minSampleRateForAttribution,
  );
  if (thin.length > 0) {
    gaps.push({
      kind: 'sample-too-small',
      detail: `${thin.length} of ${snapshots.length} snapshots sampled below the ${options.minSampleRateForAttribution} rate needed to attribute growth to a pattern (${thin.map((snapshot) => snapshot.snapshotId).join(', ')}).`,
      remedy:
        'Re-run the health check with a larger --sample-size so per-pattern figures rest on more keys.',
    });
  }

  const truncated = snapshots.filter((snapshot) => snapshot.sampling.truncated);
  if (truncated.length > 0) {
    gaps.push({
      kind: 'sample-too-small',
      detail: `Sampling was cut short by a safety bound in ${truncated.length} snapshot(s) (${truncated.map((snapshot) => snapshot.snapshotId).join(', ')}), so patterns in the unvisited remainder are missing.`,
      remedy: 'Re-run when the instance is less busy, or raise --timeout to allow a fuller scan.',
    });
  }

  return gaps;
}

function intervalGaps(
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): readonly EvidenceGap[] {
  const gaps: EvidenceGap[] = [];

  for (let index = 0; index + 1 < snapshots.length; index += 1) {
    const before = snapshots[index];
    const after = snapshots[index + 1];
    if (before === undefined || after === undefined) {
      continue;
    }

    const gap = Date.parse(after.capturedAt) - Date.parse(before.capturedAt);
    if (gap > options.maxSnapshotGapMs) {
      gaps.push({
        kind: 'snapshot-gap',
        detail: `${formatDuration(gap)} passed between ${before.snapshotId} and ${after.snapshotId}, beyond the ${formatDuration(options.maxSnapshotGapMs)} limit. This interval was not analysed, because a change anywhere inside it would look the same from the outside.`,
        remedy: 'Snapshot more often so a change can be located to a narrower window.',
      });
    }
  }

  return gaps;
}

/**
 * Snapshots whose memory counter cannot be diffed as stored size.
 *
 * The reading stays on the snapshot — a chart can still plot a real 0 — but growth comparison
 * skips it. Saying "no growth" over a window that never had two stored-size readings would claim
 * we measured something we did not.
 */
function memoryReadingGaps(snapshots: readonly RedisSnapshot[]): readonly EvidenceGap[] {
  const metric = selectGrowthMetric(snapshots);
  const excluded = snapshots.filter((snapshot) => comparableStoredBytes(snapshot, metric) === null);
  if (excluded.length === 0) {
    return [];
  }

  const details = excluded.map((snapshot) => {
    const bytes = readGrowthMetric(snapshot, metric);
    const metricPhrase = ANOMALY_METRIC_PHRASE[metric];
    if (bytes === null) {
      return `${snapshot.snapshotId} did not report ${metricPhrase}`;
    }
    return `${snapshot.snapshotId} reported ${metricPhrase} of 0 bytes while the keyspace still held ${totalKeyCount(snapshot)} keys, which is resident memory rather than an empty dataset`;
  });

  return [
    {
      kind: 'memory-not-comparable',
      detail: `${details.join('; ')}. Those snapshots were left out of memory growth comparison.`,
      remedy: null,
    },
  ];
}

/**
 * Patterns that cannot be diffed because they are absent from at least one snapshot.
 *
 * Worth recording rather than ignoring: a pattern that appears only in the newest snapshot is either
 * genuinely new — which may be the whole cause — or simply missed by an earlier sample. The evidence
 * cannot tell those apart, and pretending otherwise is how a sampling artefact becomes a diagnosis.
 */
function comparabilityGaps(snapshots: readonly RedisSnapshot[]): readonly EvidenceGap[] {
  const seenIn = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const stats of snapshot.patterns) {
      const set = seenIn.get(stats.pattern) ?? new Set<string>();
      set.add(snapshot.snapshotId);
      seenIn.set(stats.pattern, set);
    }
  }

  const partial = [...seenIn.entries()]
    .filter(([, snapshotIds]) => snapshotIds.size < snapshots.length)
    .map(([pattern]) => pattern)
    .sort((left, right) => left.localeCompare(right));

  if (partial.length === 0) {
    return [];
  }

  return [
    {
      kind: 'pattern-not-comparable',
      detail: `${partial.length} pattern(s) are absent from at least one snapshot and were not diffed: ${partial.join(', ')}. Absence from a sample means the pattern was not visited, not that it held nothing.`,
      remedy: 'A larger --sample-size makes a pattern more likely to appear in every snapshot.',
    },
  ];
}

function attributionGaps(
  anomalies: readonly AnomalyEvent[],
  attributions: readonly PatternAttribution[],
): readonly EvidenceGap[] {
  const gaps: EvidenceGap[] = [];

  for (const anomaly of anomalies) {
    const explained = attributions
      .filter((attribution) => attribution.anomalyId === anomaly.eventId)
      .reduce((sum, attribution) => sum + attribution.shareOfAnomalyGrowth, 0);

    if (explained < MIN_EXPLAINED_SHARE) {
      gaps.push({
        kind: 'unattributed-growth',
        detail: `Only ${(explained * 100).toFixed(1)}% of the ${anomalyKindInGap(anomaly.kind)} on ${ANOMALY_METRIC_PHRASE[anomaly.metric]} between ${anomaly.snapshotIdBefore} and ${anomaly.snapshotIdAfter} could be attributed to a key pattern. The change is measured; its cause is not established.`,
        remedy:
          'A larger sample, or snapshots closer together, would narrow which pattern is responsible.',
      });
    }
  }

  return gaps;
}

/**
 * Notes on each attribution whose mechanism is corroborated by an independent TTL drift event.
 *
 * The cross-reference is what turns two separate readings into one account: "this pattern grew" and
 * "this pattern stopped expiring" are far more convincing together, and the reasoner may only cite
 * what is written down here.
 */
function crossReferenceTtlDrift(
  attributions: readonly PatternAttribution[],
  ttlDrift: readonly TTLDriftEvent[],
): readonly PatternAttribution[] {
  if (ttlDrift.length === 0) {
    return attributions;
  }

  return attributions.map((attribution) => {
    if (attribution.mechanism !== 'keys-not-expiring') {
      return attribution;
    }

    const matching = ttlDrift.filter((event) => event.pattern === attribution.pattern);
    if (matching.length === 0) {
      return attribution;
    }

    return {
      ...attribution,
      observations: [
        ...attribution.observations,
        matching.length === 1
          ? 'Corroborated by TTL drift on the same pattern.'
          : `Corroborated by ${String(matching.length)} TTL drift events on the same pattern.`,
      ],
    };
  });
}

/**
 * Largest wall-clock gap between consecutive snapshots, or `null` when there are fewer than two.
 */
function largestSnapshotGapMs(snapshots: readonly RedisSnapshot[]): number | null {
  let largest: number | null = null;
  for (let index = 0; index + 1 < snapshots.length; index += 1) {
    const before = snapshots[index];
    const after = snapshots[index + 1];
    if (before === undefined || after === undefined) {
      continue;
    }
    const gap = Date.parse(after.capturedAt) - Date.parse(before.capturedAt);
    if (largest === null || gap > largest) {
      largest = gap;
    }
  }
  return largest;
}

interface StoredSizeSpan {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly ratio: number;
  readonly first: RedisSnapshot;
  readonly last: RedisSnapshot;
  readonly from: string;
  readonly to: string;
  readonly span: string;
}

function storedSizeSpan(snapshots: readonly RedisSnapshot[]): StoredSizeSpan | null {
  const metric = selectGrowthMetric(snapshots);
  const comparable = snapshots.filter(
    (snapshot) => comparableStoredBytes(snapshot, metric) !== null,
  );
  const first = comparable[0];
  const last = comparable[comparable.length - 1];
  const from = formatUtcInstant(snapshots[0]?.capturedAt ?? '');
  const to = formatUtcInstant(snapshots[snapshots.length - 1]?.capturedAt ?? '');
  const span = `Across ${String(snapshots.length)} snapshots from ${from} to ${to}.`;
  const before = first === undefined ? null : comparableStoredBytes(first, metric);
  const after = last === undefined ? null : comparableStoredBytes(last, metric);
  if (
    first === undefined ||
    last === undefined ||
    before === null ||
    after === null
  ) {
    return null;
  }
  return {
    before,
    after,
    delta: after - before,
    ratio: relativeChange(before, after),
    first,
    last,
    from,
    to,
    span,
  };
}

/**
 * When stored size cleared both anomaly bars but every comparable interval was a snapshot gap,
 * say that — never "below anomaly thresholds". Returns null when this case does not apply.
 */
function gapBlockedGrowthDetail(
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): string | null {
  const span = storedSizeSpan(snapshots);
  if (span === null || span.delta <= 0) {
    return null;
  }
  if (span.delta < options.minGrowthBytes || span.ratio < options.minGrowthRatio) {
    return null;
  }
  const largestGap = largestSnapshotGapMs(snapshots);
  if (largestGap === null || largestGap <= options.maxSnapshotGapMs) {
    return null;
  }
  return `Memory grew ${formatBinaryMagnitude(span.delta)} (+${formatRatioPercent(span.ratio)}), but a ${formatDuration(largestGap)} gap between snapshots prevents attributing it; capture snapshots at a shorter interval.`;
}

/**
 * What to say when nothing rose far enough to be an anomaly.
 *
 * A flat window may say that no growth was found. A window whose stored size did change says the
 * change, in MiB/GiB and clock time. "Below anomaly thresholds" is reserved for growth that is
 * genuinely under both bars. Patterns that account for at least `minAttributionShare` of a
 * sub-threshold rise are named as contributors. They are not attributions and they are not a cause.
 *
 * Growth that clears both bars but was blocked by a snapshot gap is handled separately via
 * `gapBlockedGrowthDetail` and folded into the `snapshot-gap` entry — not this gap kind.
 */
function noGrowthDetail(
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): string {
  const spanInfo = storedSizeSpan(snapshots);
  if (spanInfo === null || spanInfo.before === spanInfo.after) {
    const from = formatUtcInstant(snapshots[0]?.capturedAt ?? '');
    const to = formatUtcInstant(snapshots[snapshots.length - 1]?.capturedAt ?? '');
    return `No memory growth was found across ${String(snapshots.length)} snapshots from ${from} to ${to}.`;
  }

  const { delta, ratio, first, last, span } = spanInfo;
  if (delta < 0) {
    return `Memory fell ${formatBinaryMagnitude(delta)} (-${formatRatioPercent(ratio)}). ${span}`;
  }

  const growth = `Memory grew ${formatBinaryMagnitude(delta)} (+${formatRatioPercent(ratio)}), below anomaly thresholds (${formatBinaryMagnitude(options.minGrowthBytes)} and ${formatRatioPercent(options.minGrowthRatio)}).`;
  const contributors = describePatternContributors(first, last, delta, options);
  return [growth, ...contributors, span].join(' ');
}

/**
 * Composes the detectors into the single `EvidenceGraph` that the rest of the system consumes.
 *
 * The only producer of an `EvidenceGraph`. `packages/reasoner` reads one and may not add to it, so
 * anything a user is ever told must be established here — including, importantly, the things that
 * could *not* be established. An empty graph carrying a populated `gaps` list is a correct and
 * useful result; an empty graph carrying no gaps is a bug, because it reads to the user as "your
 * Redis is fine". That invariant is why `no-growth-detected` exists: a flat, well-observed window
 * still says out loud what it examined.
 *
 * Deliberately absent: `no-repository-connected`. This function is given snapshots and nothing else,
 * so it has no way to know whether a repository is available. That gap belongs to whoever assembles
 * the commit candidates.
 */
export function buildEvidenceGraph(input: BuildEvidenceGraphInput): EvidenceGraph {
  const options = resolveEvidenceOptions(input.options);
  const snapshots = sortSnapshotsChronologically(input.snapshots);
  const window = windowOf(snapshots, input.builtAt);
  const snapshotIds = snapshots.map((snapshot) => snapshot.snapshotId);

  // Deliberately excludes `builtAt`: the id identifies *what was analysed*, not when, so re-running
  // over the same snapshots yields the same graph id and the same citations.
  const graphId = createEvidenceId('graph', [window.from, window.to, ...snapshotIds]);

  if (snapshots.length < 2) {
    return {
      graphId,
      builtAt: input.builtAt,
      window,
      snapshotIds,
      anomalies: [],
      attributions: [],
      ttlDrift: [],
      gaps: [
        {
          kind: 'insufficient-snapshots',
          detail: `Growth needs at least two snapshots to establish; ${snapshots.length} was supplied. A single snapshot shows what is in the instance, never how it got there.`,
          remedy:
            'Run the health check again later and pass both snapshots, so the two can be compared.',
        },
      ],
    };
  }

  const anomalies = detectMemoryAnomalies(snapshots, options);
  const ttlDrift = detectTtlDrift(snapshots, options);

  const attributions = crossReferenceTtlDrift(
    anomalies.flatMap((anomaly) => attributeGrowthToPatterns(anomaly, snapshots, options)),
    ttlDrift,
  );

  const growthMetric = selectGrowthMetric(snapshots);
  const storedSizeReadings = snapshots.filter(
    (snapshot) => comparableStoredBytes(snapshot, growthMetric) !== null,
  ).length;

  const gapBlockedDetail = gapBlockedGrowthDetail(snapshots, options);
  const gaps: EvidenceGap[] = [
    ...sampleGaps(snapshots, options),
    ...intervalGaps(snapshots, options).map((gap) =>
      gapBlockedDetail === null
        ? gap
        : {
            ...gap,
            // Lead with the growth sentence so the reasoner headline/summary stay honest.
            detail: `${gapBlockedDetail} ${gap.detail}`,
          },
    ),
    ...comparabilityGaps(snapshots),
    ...memoryReadingGaps(snapshots),
    ...attributionGaps(anomalies, attributions),
  ];

  // Two stored-size readings are what a statement about memory movement is earned with. Fewer than
  // that, and the memory-not-comparable gap is the honest result. The detail distinguishes a flat
  // window from one that moved and still missed the anomaly rule. Supra-threshold growth blocked by
  // a snapshot gap is already recorded on that gap — do not also claim "no growth detected".
  if (
    gapBlockedDetail === null &&
    anomalies.length === 0 &&
    ttlDrift.length === 0 &&
    storedSizeReadings >= 2
  ) {
    gaps.push({
      kind: 'no-growth-detected',
      detail: noGrowthDetail(snapshots, options),
      remedy: null,
    });
  }

  return {
    graphId,
    builtAt: input.builtAt,
    window,
    snapshotIds,
    anomalies,
    attributions,
    ttlDrift,
    // Stable order so two runs over the same snapshots produce byte-identical graphs.
    gaps: gaps.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.detail.localeCompare(right.detail),
    ),
  };
}
