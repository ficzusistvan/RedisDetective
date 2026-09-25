import type { KeyPatternStats, RedisSnapshot, SamplingMetadata } from '@redis-detective/core-types';

/**
 * Builds a snapshot for report tests.
 *
 * Defaults describe a healthy instance, so each test overrides only the fields its rule is about
 * and the assertion says what it is testing.
 */
export function snapshotFixture(overrides: Partial<RedisSnapshot> = {}): RedisSnapshot {
  return {
    snapshotId: 'snapshot-1',
    capturedAt: '2026-08-25T10:00:00.000Z',
    instance: {
      redisVersion: '7.2.4',
      mode: 'standalone',
      role: 'master',
      maxmemoryBytes: 1_073_741_824,
      maxmemoryPolicy: 'noeviction',
      uptimeSeconds: 86_400,
    },
    memory: {
      usedMemoryBytes: 104_857_600,
      usedMemoryRssBytes: 115_343_360,
      usedMemoryDatasetBytes: 94_371_840,
      usedMemoryPeakBytes: 104_857_600,
      memFragmentationRatio: 1.1,
      evictedKeys: 0,
      expiredKeys: 100,
    },
    keyspace: [{ db: 0, keyCount: 100_000, keysWithExpiry: 90_000, averageTtlMs: 3_600_000 }],
    patterns: [],
    sampling: samplingFixture(),
    ...overrides,
  };
}

export function samplingFixture(overrides: Partial<SamplingMetadata> = {}): SamplingMetadata {
  return {
    strategy: 'randomized-scan',
    requestedSampleSize: 1_000,
    observedSampleSize: 1_000,
    scanPasses: 10,
    effectiveSampleRate: 0.01,
    durationMs: 250,
    truncated: false,
    warnings: [],
    ...overrides,
  };
}

export function patternFixture(overrides: Partial<KeyPatternStats> = {}): KeyPatternStats {
  return {
    pattern: 'session:*',
    dataType: 'string',
    sampledKeyCount: 500,
    sampledBytes: 512_000,
    estimatedKeyCount: 50_000,
    estimatedBytes: 51_200_000,
    bytesMeasured: true,
    keysWithTtl: 500,
    keysWithoutTtl: 0,
    medianTtlSeconds: 3_600,
    exampleKeys: ['session:aaa111', 'session:bbb222'],
    estimateBasis: 'sampled-extrapolation',
    ...overrides,
  };
}
