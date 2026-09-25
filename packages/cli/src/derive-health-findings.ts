import type { KeyPatternStats, RedisSnapshot } from '@redis-detective/core-types';

import type { HealthFinding } from './health-check-report.js';
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatEstimatedBytes,
  formatPercent,
} from './format-bytes.js';
import { gradeFindingStrength, measuredFindingStrength } from './grade-finding-strength.js';

export const HEALTH_CHECK_THRESHOLDS = {
  /** Share of estimated data a pattern must hold before it is worth naming. */
  dominantPatternShare: 0.2,
  maxDominantPatterns: 3,
  /** A pattern needs this many estimated keys before its TTL coverage is worth reporting. */
  minKeysForTtlFinding: 50,
  /** And this share of estimated data, so a tiny never-expiring pattern is not alarming. */
  minShareForTtlFinding: 0.05,
  /** TTL coverage below this, but above zero, reads as an inconsistent write path. */
  partialTtlCoverageCeiling: 0.9,
  /** `used_memory` against `maxmemory` beyond which headroom is a problem. */
  lowHeadroomRatio: 0.8,
  highFragmentationRatio: 1.5,
  /** Fragmentation ratio is noisy on small instances, so only report it above this size. */
  fragmentationFloorBytes: 64 * 1_024 * 1_024,
  /** Below this sampled share, the pattern findings deserve an explicit caveat. */
  thinSampleRate: 0.01,
} as const;

interface PatternTotals {
  readonly bytes: number;
  readonly keys: number;
  /** False when no pattern carries a byte figure, so shares must be taken from key counts. */
  readonly bytesMeasured: boolean;
}

function patternTotals(patterns: readonly KeyPatternStats[]): PatternTotals {
  return {
    bytes: patterns.reduce((sum, pattern) => sum + pattern.estimatedBytes, 0),
    keys: patterns.reduce((sum, pattern) => sum + pattern.estimatedKeyCount, 0),
    bytesMeasured: patterns.some((pattern) => pattern.bytesMeasured),
  };
}

/**
 * A pattern's share of the instance, by bytes where possible and by key count otherwise.
 *
 * The fallback is what keeps this useful on a managed provider that blocks `MEMORY USAGE`. Without
 * it every byte figure is zero, so every share is zero, and the size thresholds below would filter
 * out every finding — including the TTL leak, which is the most valuable thing here and needs no
 * byte figures at all.
 */
function shareOf(pattern: KeyPatternStats, totals: PatternTotals): number {
  if (totals.bytesMeasured && totals.bytes > 0) {
    return pattern.estimatedBytes / totals.bytes;
  }
  return totals.keys === 0 ? 0 : pattern.estimatedKeyCount / totals.keys;
}

/** Describes what a share was computed from, so the report never implies bytes it never had. */
function shareUnit(totals: PatternTotals): string {
  return totals.bytesMeasured && totals.bytes > 0 ? 'sampled data' : 'sampled keys';
}

function describeSize(pattern: KeyPatternStats): string {
  return pattern.bytesMeasured
    ? formatEstimatedBytes(pattern.estimatedBytes, pattern.estimateBasis !== 'exact')
    : 'an unmeasured amount of memory';
}

function ttlCoverage(pattern: KeyPatternStats): number | null {
  const total = pattern.keysWithTtl + pattern.keysWithoutTtl;
  return total === 0 ? null : pattern.keysWithTtl / total;
}

function patternStrength(snapshot: RedisSnapshot, pattern: KeyPatternStats) {
  return gradeFindingStrength({
    effectiveSampleRate: snapshot.sampling.effectiveSampleRate,
    sampleTruncated: snapshot.sampling.truncated,
    estimateBasis: pattern.estimateBasis,
    sampledKeyCount: pattern.sampledKeyCount,
  });
}

function deriveEvictionFinding(snapshot: RedisSnapshot): HealthFinding | null {
  if (snapshot.memory.evictedKeys <= 0) {
    return null;
  }
  return {
    kind: 'evictions-active',
    title: 'Keys are being evicted',
    detail: `Redis has evicted ${formatCount(snapshot.memory.evictedKeys, false)} keys under the ${snapshot.instance.maxmemoryPolicy} policy, so the instance is already at its memory ceiling and is silently dropping data.`,
    evidenceStrength: measuredFindingStrength(),
    recommendedAction:
      'Treat this as data loss in progress: raise maxmemory or reduce what is stored before investigating further.',
  };
}

function deriveHeadroomFinding(snapshot: RedisSnapshot): HealthFinding | null {
  const { maxmemoryBytes } = snapshot.instance;
  if (maxmemoryBytes === null) {
    return null;
  }

  const used = snapshot.memory.usedMemoryBytes / maxmemoryBytes;
  if (used < HEALTH_CHECK_THRESHOLDS.lowHeadroomRatio) {
    return null;
  }

  return {
    kind: 'low-headroom',
    title: `Only ${formatBytes(maxmemoryBytes - snapshot.memory.usedMemoryBytes)} of headroom left`,
    detail: `${formatBytes(snapshot.memory.usedMemoryBytes)} of ${formatBytes(maxmemoryBytes)} is in use (${formatPercent(used)}), with maxmemory-policy set to ${snapshot.instance.maxmemoryPolicy}.`,
    evidenceStrength: measuredFindingStrength(),
    recommendedAction:
      snapshot.instance.maxmemoryPolicy === 'noeviction'
        ? 'With noeviction, writes will start failing rather than evicting. Free space or raise the ceiling.'
        : 'Expect evictions as the ceiling is reached. Free space or raise the ceiling.',
  };
}

function deriveFragmentationFinding(snapshot: RedisSnapshot): HealthFinding | null {
  const { memFragmentationRatio, usedMemoryBytes, usedMemoryRssBytes } = snapshot.memory;
  if (
    memFragmentationRatio < HEALTH_CHECK_THRESHOLDS.highFragmentationRatio ||
    usedMemoryBytes < HEALTH_CHECK_THRESHOLDS.fragmentationFloorBytes
  ) {
    return null;
  }

  return {
    kind: 'high-fragmentation',
    title: `Memory fragmentation ratio is ${memFragmentationRatio.toFixed(2)}`,
    detail: `The process holds ${formatBytes(usedMemoryRssBytes)} of RSS for ${formatBytes(usedMemoryBytes)} of data, so a meaningful share of the footprint is allocator overhead rather than stored values.`,
    evidenceStrength: measuredFindingStrength(),
    recommendedAction:
      'This is allocator behaviour, not growth in your data. Check activedefrag before hunting for a key pattern.',
  };
}

function deriveTtlFindings(snapshot: RedisSnapshot): readonly HealthFinding[] {
  const totals = patternTotals(snapshot.patterns);
  const findings: HealthFinding[] = [];

  for (const pattern of snapshot.patterns) {
    const coverage = ttlCoverage(pattern);
    if (coverage === null || coverage >= HEALTH_CHECK_THRESHOLDS.partialTtlCoverageCeiling) {
      continue;
    }

    const isEstimate = pattern.estimateBasis !== 'exact';
    if (
      pattern.estimatedKeyCount < HEALTH_CHECK_THRESHOLDS.minKeysForTtlFinding ||
      shareOf(pattern, totals) < HEALTH_CHECK_THRESHOLDS.minShareForTtlFinding
    ) {
      continue;
    }

    if (coverage === 0) {
      findings.push({
        kind: 'no-ttl-coverage',
        title: `${pattern.pattern} never expires`,
        detail: `None of the ${formatCount(pattern.sampledKeyCount, false)} sampled keys under ${pattern.pattern} carry a TTL, covering ${formatCount(pattern.estimatedKeyCount, isEstimate)} keys and ${describeSize(pattern)}. If this data is meant to be a cache, nothing is reclaiming it.`,
        evidenceStrength: patternStrength(snapshot, pattern),
        recommendedAction: `Check the write path for ${pattern.pattern}: a SET without EX, or an EXPIRE that is no longer called, grows memory indefinitely.`,
      });
      continue;
    }

    findings.push({
      kind: 'partial-ttl-coverage',
      // The most useful single signal the health check produces: same pattern, two behaviours.
      title: `${pattern.pattern} expires inconsistently`,
      detail: `Only ${formatPercent(coverage)} of sampled ${pattern.pattern} keys carry a TTL (${formatCount(pattern.keysWithTtl, false)} of ${formatCount(pattern.keysWithTtl + pattern.keysWithoutTtl, false)}), median ${pattern.medianTtlSeconds === null ? 'unknown' : formatDuration(pattern.medianTtlSeconds)}. One write path is setting an expiry and another is not.`,
      evidenceStrength: patternStrength(snapshot, pattern),
      recommendedAction: `Find every writer of ${pattern.pattern} and confirm they all set an expiry. A mixed pattern usually means a recent change to one of them.`,
    });
  }

  return findings;
}

function deriveDominantPatternFindings(snapshot: RedisSnapshot): readonly HealthFinding[] {
  const totals = patternTotals(snapshot.patterns);
  if (totals.keys === 0) {
    return [];
  }

  return snapshot.patterns
    .filter((pattern) => shareOf(pattern, totals) >= HEALTH_CHECK_THRESHOLDS.dominantPatternShare)
    .slice(0, HEALTH_CHECK_THRESHOLDS.maxDominantPatterns)
    .map((pattern) => {
      const isEstimate = pattern.estimateBasis !== 'exact';
      const examples =
        pattern.exampleKeys.length === 0 ? '' : ` Examples: ${pattern.exampleKeys.join(', ')}.`;
      return {
        kind: 'dominant-pattern' as const,
        title: `${pattern.pattern} holds ${formatPercent(shareOf(pattern, totals))} of ${shareUnit(totals)}`,
        detail: `${describeSize(pattern)} across ${formatCount(pattern.estimatedKeyCount, isEstimate)} ${pattern.dataType} keys, from ${formatCount(pattern.sampledKeyCount, false)} sampled.${examples}`,
        evidenceStrength: patternStrength(snapshot, pattern),
        recommendedAction: null,
      };
    });
}

function deriveThinSampleFinding(snapshot: RedisSnapshot): HealthFinding | null {
  const { effectiveSampleRate, truncated, observedSampleSize } = snapshot.sampling;
  if (!truncated && effectiveSampleRate >= HEALTH_CHECK_THRESHOLDS.thinSampleRate) {
    return null;
  }
  if (observedSampleSize === 0) {
    return null;
  }

  return {
    kind: 'thin-sample',
    title: 'Pattern figures come from a thin sample',
    detail: `${formatCount(observedSampleSize, false)} keys were sampled, ${formatPercent(effectiveSampleRate)} of the key space${truncated ? ', and a sampling bound stopped the scan early' : ''}. Per-pattern figures are extrapolations and a pattern smaller than the sample may be missing entirely.`,
    evidenceStrength: 'unclear',
    recommendedAction:
      'Raise --sample-size for a firmer picture, or re-run when the instance is less busy.',
  };
}

/**
 * Derives the findings a single snapshot can honestly support.
 *
 * Pure: snapshot in, findings out, no I/O and no clock, so every rule is directly unit testable.
 *
 * Describes the current state only. One snapshot shows what is *in* the instance, never why it
 * grew — that needs two snapshots and an `EvidenceGraph`, which is why nothing here uses causal
 * language even where the shape of the data is suggestive. Findings are ordered by urgency: what
 * is actively losing data first, what is merely large last.
 */
export function deriveHealthFindings(snapshot: RedisSnapshot): readonly HealthFinding[] {
  return [
    deriveEvictionFinding(snapshot),
    deriveHeadroomFinding(snapshot),
    ...deriveTtlFindings(snapshot),
    ...deriveDominantPatternFindings(snapshot),
    deriveFragmentationFinding(snapshot),
    deriveThinSampleFinding(snapshot),
  ].filter((finding): finding is HealthFinding => finding !== null);
}
