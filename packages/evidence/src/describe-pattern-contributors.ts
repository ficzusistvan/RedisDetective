import type { KeyPatternStats, RedisSnapshot } from '@redis-detective/core-types';

import type { ResolvedEvidenceOptions } from './evidence-options.js';
import { formatBinaryMagnitude } from './format-reported-quantity.js';
import { relativeChange } from './relative-change.js';
import { ttlCoverage } from './ttl-coverage.js';

/**
 * How a pattern's estimated bytes moved, phrased as a contributor rather than a cause.
 *
 * `null` when the sample cannot separate more keys from larger values. Naming one of those anyway
 * would invent a mechanism the sample does not support.
 */
function contributorPhrase(
  before: KeyPatternStats,
  after: KeyPatternStats,
  options: ResolvedEvidenceOptions,
): string | null {
  const coverageBefore = ttlCoverage(before.keysWithTtl, before.keysWithoutTtl);
  const coverageAfter = ttlCoverage(after.keysWithTtl, after.keysWithoutTtl);
  const ttlCoverageFell =
    coverageBefore !== null &&
    coverageAfter !== null &&
    coverageBefore - coverageAfter >= options.minTtlCoverageDrop;
  if (ttlCoverageFell) {
    return 'as keys that stopped expiring';
  }

  const keyGrowth = relativeChange(before.estimatedKeyCount, after.estimatedKeyCount);
  const sizeBefore =
    before.estimatedKeyCount <= 0 ? null : before.estimatedBytes / before.estimatedKeyCount;
  const sizeAfter =
    after.estimatedKeyCount <= 0 ? null : after.estimatedBytes / after.estimatedKeyCount;
  const sizeGrowth =
    sizeBefore === null || sizeAfter === null ? 0 : relativeChange(sizeBefore, sizeAfter);

  if (keyGrowth >= options.minGrowthRatio && keyGrowth > sizeGrowth) {
    return 'as more keys';
  }
  if (sizeGrowth >= options.minGrowthRatio && sizeGrowth > keyGrowth) {
    return 'as larger values';
  }
  return null;
}

function patternKey(stats: KeyPatternStats): string {
  return `${stats.dataType}\u0000${stats.pattern}`;
}

/**
 * Names patterns whose estimated bytes account for a real share of a measured memory change.
 *
 * Used when no anomaly fired, so the sentences stay contributors: they do not become attributions
 * and they are not a likely cause. A pattern under `minAttributionShare` is left out. The remainder
 * is not assigned to the largest pattern.
 */
export function describePatternContributors(
  before: RedisSnapshot,
  after: RedisSnapshot,
  measuredBytesGrowth: number,
  options: ResolvedEvidenceOptions,
): readonly string[] {
  if (measuredBytesGrowth <= 0) {
    return [];
  }

  const beforeByKey = new Map(before.patterns.map((stats) => [patternKey(stats), stats]));
  const ranked = after.patterns
    .flatMap((afterStats) => {
      const beforeStats = beforeByKey.get(patternKey(afterStats));
      if (beforeStats === undefined || !beforeStats.bytesMeasured || !afterStats.bytesMeasured) {
        return [];
      }
      const bytesGrowth = afterStats.estimatedBytes - beforeStats.estimatedBytes;
      if (bytesGrowth <= 0) {
        return [];
      }
      const share = Math.min(bytesGrowth / measuredBytesGrowth, 1);
      if (share < options.minAttributionShare) {
        return [];
      }
      return [{ before: beforeStats, after: afterStats, bytesGrowth }];
    })
    .sort(
      (left, right) =>
        right.bytesGrowth - left.bytesGrowth ||
        left.after.pattern.localeCompare(right.after.pattern),
    )
    .slice(0, options.maxAttributionsPerAnomaly);

  return ranked.map((entry, index) => {
    const verb = index === 0 ? 'contributed the most estimated growth' : 'contributed';
    const size = formatBinaryMagnitude(entry.bytesGrowth);
    const how = contributorPhrase(entry.before, entry.after, options);
    return how === null
      ? `${entry.after.pattern} ${verb}, ${size}.`
      : `${entry.after.pattern} ${verb}, ${size}, ${how}.`;
  });
}
