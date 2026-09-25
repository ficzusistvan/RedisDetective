import type { RedisSnapshot } from '@redis-detective/core-types';

import { patternFixture, snapshotFixture } from './snapshot-builder.js';

const MB = 1_024 * 1_024;

function hoursIn(hours: number): string {
  return new Date(Date.UTC(2026, 7, 25, 10 + hours, 0, 0)).toISOString();
}

/**
 * A TTL leak on `cart:items:*` that grows gradually over four hours — the diagnosis the CLI
 * exists to print. Numbers match the evidence package's leak fixture so the two cannot disagree
 * about what this shape of growth is.
 */
export function leakingSnapshots(): readonly RedisSnapshot[] {
  const coverage = [100, 70, 30, 0];

  return [64 * MB, 72 * MB, 80 * MB, 88 * MB].map((usedMemoryBytes, index) => {
    const ttl = coverage[index] ?? 0;
    return snapshotFixture({
      snapshotId: `snapshot-${index + 1}`,
      capturedAt: hoursIn(index),
      memory: {
        usedMemoryBytes,
        usedMemoryRssBytes: Math.round(usedMemoryBytes * 1.2),
        usedMemoryDatasetBytes: Math.round(usedMemoryBytes * 0.9),
        usedMemoryPeakBytes: usedMemoryBytes,
        memFragmentationRatio: 1.2,
        evictedKeys: 0,
        expiredKeys: 0,
      },
      keyspace: [
        {
          db: 0,
          keyCount: 10_000 + index * 20_000,
          keysWithExpiry: 9_000,
          averageTtlMs: 3_600_000,
        },
      ],
      patterns: [
        patternFixture({
          pattern: 'cart:items:*',
          sampledKeyCount: 100,
          estimatedBytes: (30 + index * 8) * MB,
          estimatedKeyCount: 1_000 + index * 20_000,
          keysWithTtl: ttl,
          keysWithoutTtl: 100 - ttl,
        }),
      ],
    });
  });
}
