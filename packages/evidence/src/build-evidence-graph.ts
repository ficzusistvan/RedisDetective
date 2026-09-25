import type {
  AnomalyEvent,
  EvidenceGap,
  EvidenceGraph,
  PatternAttribution,
  RedisSnapshot,
  TTLDriftEvent,
  TimeWindow,
} from '@redis-detective/core-types';

import type { EvidenceOptions, ResolvedEvidenceOptions } from './evidence-options.js';
import { attributeGrowthToPatterns } from './attribute-growth-to-patterns.js';
import { createEvidenceId } from './create-evidence-id.js';
import { detectMemoryAnomalies } from './detect-memory-anomalies.js';
import { detectTtlDrift } from './detect-ttl-drift.js';
import { resolveEvidenceOptions } from './evidence-options.js';
import { sortSnapshotsChronologically } from './sort-snapshots-chronologically.js';

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
        detail: `${gap}ms passed between ${before.snapshotId} and ${after.snapshotId}, beyond the ${options.maxSnapshotGapMs}ms limit. This interval was not analysed, because a change anywhere inside it would look the same from the outside.`,
        remedy: 'Snapshot more often so a change can be located to a narrower window.',
      });
    }
  }

  return gaps;
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
        detail: `Only ${(explained * 100).toFixed(1)}% of the ${anomaly.kind} on ${anomaly.metric} between ${anomaly.snapshotIdBefore} and ${anomaly.snapshotIdAfter} could be attributed to a key pattern. The change is measured; its cause is not established.`,
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
        `Corroborated by TTL drift event(s) ${matching.map((event) => event.eventId).join(', ')} on the same pattern.`,
      ],
    };
  });
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

  const gaps: EvidenceGap[] = [
    ...sampleGaps(snapshots, options),
    ...intervalGaps(snapshots, options),
    ...comparabilityGaps(snapshots),
    ...attributionGaps(anomalies, attributions),
  ];

  if (anomalies.length === 0 && ttlDrift.length === 0) {
    gaps.push({
      kind: 'no-growth-detected',
      detail: `No memory anomaly or TTL drift was found across ${snapshots.length} snapshots spanning ${window.from} to ${window.to}. Memory did not grow by more than the ${options.minGrowthBytes}-byte and ${options.minGrowthRatio} thresholds in any comparable interval.`,
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
      (left, right) => left.kind.localeCompare(right.kind) || left.detail.localeCompare(right.detail),
    ),
  };
}
