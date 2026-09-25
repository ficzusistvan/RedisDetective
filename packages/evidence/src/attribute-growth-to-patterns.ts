import type {
  AnomalyEvent,
  GrowthMechanism,
  KeyPatternStats,
  PatternAttribution,
  RedisSnapshot,
} from '@redis-detective/core-types';

import type { ResolvedEvidenceOptions } from './evidence-options.js';
import { createEvidenceId } from './create-evidence-id.js';
import { describeChange } from './describe-change.js';
import { gradeEvidenceStrength } from './grade-evidence-strength.js';
import { relativeChange } from './relative-change.js';
import { ttlCoverage } from './ttl-coverage.js';

/**
 * Patterns are matched on name *and* data type: `queue:*` as a list and `queue:*` as a hash are
 * different storage with different growth behaviour, and diffing one against the other would report
 * a type migration as a leak.
 */
function patternKey(stats: KeyPatternStats): string {
  return `${stats.dataType}\u0000${stats.pattern}`;
}

function indexPatterns(snapshot: RedisSnapshot): ReadonlyMap<string, KeyPatternStats> {
  return new Map(snapshot.patterns.map((stats) => [patternKey(stats), stats]));
}

function bytesPerKey(stats: KeyPatternStats): number | null {
  return stats.estimatedKeyCount <= 0 ? null : stats.estimatedBytes / stats.estimatedKeyCount;
}

/** The unit a pattern's share of growth is measured in. */
type ShareUnit = 'bytes' | 'keys';

interface GrowthBasis {
  readonly unit: ShareUnit;
  /** Total growth the anomaly is asking to have explained, in `unit`. */
  readonly total: number;
  /** Why keys were used instead of bytes, for the attribution's observations. */
  readonly keyFallbackReason: string | null;
}

interface PatternDiff {
  readonly stats: KeyPatternStats;
  readonly bytesGrowth: number;
  readonly keyCountGrowth: number;
  readonly mechanism: GrowthMechanism;
  readonly observations: readonly string[];
  readonly ttlCoverageFell: boolean;
}

function classifyMechanism(
  before: KeyPatternStats,
  after: KeyPatternStats,
  options: ResolvedEvidenceOptions,
): { readonly mechanism: GrowthMechanism; readonly ttlCoverageFell: boolean } {
  const coverageBefore = ttlCoverage(before.keysWithTtl, before.keysWithoutTtl);
  const coverageAfter = ttlCoverage(after.keysWithTtl, after.keysWithoutTtl);
  const ttlCoverageFell =
    coverageBefore !== null &&
    coverageAfter !== null &&
    coverageBefore - coverageAfter >= options.minTtlCoverageDrop;

  // Checked before the other two on purpose. Keys that stopped expiring also show up as "more
  // keys", so testing key count first would label every TTL regression with the vaguer mechanism
  // and lose the one finding that points at a specific line of code.
  if (ttlCoverageFell) {
    return { mechanism: 'keys-not-expiring', ttlCoverageFell };
  }

  const keyGrowth = relativeChange(before.estimatedKeyCount, after.estimatedKeyCount);
  const sizeBefore = bytesPerKey(before);
  const sizeAfter = bytesPerKey(after);
  const sizeGrowth =
    sizeBefore === null || sizeAfter === null ? 0 : relativeChange(sizeBefore, sizeAfter);

  if (keyGrowth >= options.minGrowthRatio && keyGrowth > sizeGrowth) {
    return { mechanism: 'more-keys', ttlCoverageFell };
  }
  if (sizeGrowth >= options.minGrowthRatio && sizeGrowth > keyGrowth) {
    return { mechanism: 'larger-values', ttlCoverageFell };
  }

  // The sample cannot separate the two. Saying so beats picking the likelier-looking one.
  return { mechanism: 'indeterminate', ttlCoverageFell };
}

function diffPattern(
  before: KeyPatternStats,
  after: KeyPatternStats,
  options: ResolvedEvidenceOptions,
): PatternDiff {
  const { mechanism, ttlCoverageFell } = classifyMechanism(before, after, options);
  const sizeBefore = bytesPerKey(before);
  const sizeAfter = bytesPerKey(after);

  const observations = [
    describeChange(
      `estimated bytes for ${after.pattern}`,
      before.estimatedBytes,
      after.estimatedBytes,
      'bytes',
    ),
    describeChange(
      `estimated key count for ${after.pattern}`,
      before.estimatedKeyCount,
      after.estimatedKeyCount,
      'keys',
    ),
  ];

  if (sizeBefore !== null && sizeAfter !== null) {
    observations.push(
      describeChange(
        `mean bytes per key for ${after.pattern}`,
        Math.round(sizeBefore),
        Math.round(sizeAfter),
        'bytes',
      ),
    );
  }
  if (!after.bytesMeasured) {
    observations.push(
      'MEMORY USAGE was unavailable for this pattern, so its share was measured in keys rather than bytes.',
    );
  }

  return {
    stats: after,
    bytesGrowth: after.estimatedBytes - before.estimatedBytes,
    keyCountGrowth: after.estimatedKeyCount - before.estimatedKeyCount,
    mechanism,
    ttlCoverageFell,
    observations,
  };
}

function sumPositive(diffs: readonly PatternDiff[], unit: ShareUnit): number {
  return diffs.reduce((sum, diff) => {
    const growth = unit === 'bytes' ? diff.bytesGrowth : diff.keyCountGrowth;
    return growth > 0 ? sum + growth : sum;
  }, 0);
}

/**
 * Decides what unit to measure shares in, and what total to measure them against.
 *
 * Bytes first, because that is what a memory question is really asking and because the anomaly's own
 * `deltaBytes` is a figure the user can check against their own `INFO` output.
 *
 * Two situations force a fall back to key counts, and both would otherwise divide by zero and so
 * silently drop every attribution — the same failure as answering "nothing caused this":
 *
 * 1. The instance blocks `MEMORY USAGE`, so every byte figure is zero. Managed providers do this.
 * 2. The anomaly is not about bytes at all. `key-count-growth` and `fragmentation-growth` carry no
 *    byte delta, and a pattern can add a million keys without its estimated bytes moving much.
 *
 * Key counts are a weaker unit than bytes, but they still name the right pattern, and the
 * substitution is recorded in the attribution's observations rather than left for the reader to
 * infer.
 */
function growthBasis(
  anomaly: AnomalyEvent,
  diffs: readonly PatternDiff[],
  bytesMeasured: boolean,
): GrowthBasis | null {
  if (bytesMeasured) {
    if (anomaly.deltaBytes !== null && anomaly.deltaBytes > 0) {
      return { unit: 'bytes', total: anomaly.deltaBytes, keyFallbackReason: null };
    }

    const byteGrowth = sumPositive(diffs, 'bytes');
    if (byteGrowth > 0) {
      return { unit: 'bytes', total: byteGrowth, keyFallbackReason: null };
    }
  }

  const keyGrowth = sumPositive(diffs, 'keys');
  if (keyGrowth <= 0) {
    return null;
  }

  return {
    unit: 'keys',
    total: keyGrowth,
    keyFallbackReason: bytesMeasured
      ? `the anomaly was measured in ${anomaly.metric} rather than in bytes`
      : 'MEMORY USAGE was unavailable, so no byte figures exist',
  };
}

/**
 * Works out which key patterns account for an anomaly's growth.
 *
 * This is the product's central claim, so it is also where overclaiming is most tempting. Two
 * rules hold it in check: a pattern is only named when it clears `minAttributionShare`, and
 * growth that no pattern explains must be left unattributed so `buildEvidenceGraph` can record an
 * `unattributed-growth` gap. Silently assigning the remainder to the largest pattern would produce
 * a confident, wrong answer — the worst failure mode this tool has.
 *
 * A pattern present in only one of the two snapshots is not comparable and is skipped rather than
 * diffed against an assumed zero. Absence in a sample means "not sampled this time", not "gone":
 * treating it as zero would manufacture growth for anything that happened to be missed, and
 * manufacture shrinkage for anything newly caught. `buildEvidenceGraph` records those as
 * `pattern-not-comparable`.
 */
export function attributeGrowthToPatterns(
  anomaly: AnomalyEvent,
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): readonly PatternAttribution[] {
  const before = snapshots.find((snapshot) => snapshot.snapshotId === anomaly.snapshotIdBefore);
  const after = snapshots.find((snapshot) => snapshot.snapshotId === anomaly.snapshotIdAfter);
  if (before === undefined || after === undefined || before.snapshotId === after.snapshotId) {
    return [];
  }

  const beforeByKey = indexPatterns(before);
  const comparable: { before: KeyPatternStats; after: KeyPatternStats }[] = [];
  for (const afterStats of after.patterns) {
    const beforeStats = beforeByKey.get(patternKey(afterStats));
    if (beforeStats !== undefined) {
      comparable.push({ before: beforeStats, after: afterStats });
    }
  }
  if (comparable.length === 0) {
    return [];
  }

  const bytesMeasured = comparable.every(
    (pair) => pair.before.bytesMeasured && pair.after.bytesMeasured,
  );
  const diffs = comparable.map((pair) => diffPattern(pair.before, pair.after, options));

  const basis = growthBasis(anomaly, diffs, bytesMeasured);
  if (basis === null) {
    return [];
  }

  // Snapshots inside the anomaly window support the finding; an anomaly spanning a rising run has
  // more of them than the two endpoints, and that extra corroboration is what earns 'strong'.
  const windowFrom = Date.parse(anomaly.window.from);
  const windowTo = Date.parse(anomaly.window.to);
  const spanning = snapshots.filter((snapshot) => {
    const at = Date.parse(snapshot.capturedAt);
    return at >= windowFrom && at <= windowTo;
  });
  const spanningSampleRate = Math.min(
    ...spanning.map((snapshot) => snapshot.sampling.effectiveSampleRate),
  );

  const attributions = diffs
    .map((diff) => {
      const growth = basis.unit === 'bytes' ? diff.bytesGrowth : diff.keyCountGrowth;
      // Clamped: extrapolation noise can put one pattern's estimated growth above the measured
      // total, and a share above 1 would read as explaining more than all of it.
      const share = Math.min(Math.max(growth / basis.total, 0), 1);
      return { diff, growth, share };
    })
    .filter((entry) => entry.growth > 0 && entry.share >= options.minAttributionShare)
    .sort(
      (left, right) =>
        right.share - left.share ||
        right.growth - left.growth ||
        left.diff.stats.pattern.localeCompare(right.diff.stats.pattern),
    )
    .slice(0, options.maxAttributionsPerAnomaly)
    .map(({ diff, share }): PatternAttribution => {
      const unitNote =
        basis.keyFallbackReason === null
          ? `Accounts for ${(share * 100).toFixed(1)}% of the ${anomaly.metric} growth in this window.`
          : `Accounts for ${(share * 100).toFixed(1)}% of the key growth in this window, measured in keys because ${basis.keyFallbackReason}.`;

      return {
        attributionId: createEvidenceId('attribution', [
          anomaly.eventId,
          diff.stats.pattern,
          diff.stats.dataType,
        ]),
        anomalyId: anomaly.eventId,
        pattern: diff.stats.pattern,
        mechanism: diff.mechanism,
        bytesGrowth: diff.bytesGrowth,
        keyCountGrowth: diff.keyCountGrowth,
        shareOfAnomalyGrowth: share,
        evidenceStrength: gradeEvidenceStrength({
          supportingSnapshotCount: spanning.length,
          effectiveSampleRate: Number.isFinite(spanningSampleRate) ? spanningSampleRate : 0,
          shareOfGrowth: share,
          sampleTruncated: spanning.some((snapshot) => snapshot.sampling.truncated),
          // A falling TTL coverage alongside growth is two independent readings agreeing.
          hasCorroboratingSignal: diff.ttlCoverageFell,
        }),
        supportingSnapshotIds: spanning.map((snapshot) => snapshot.snapshotId),
        observations: [...diff.observations, unitNote],
      };
    });

  return attributions;
}
