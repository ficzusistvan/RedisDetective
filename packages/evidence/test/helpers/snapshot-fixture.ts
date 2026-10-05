import type {
  KeyPatternStats,
  RedisDataType,
  RedisInstanceIdentity,
  RedisMemoryFacts,
  RedisSnapshot,
  SamplingMetadata,
} from '@redis-detective/core-types';

export interface PatternFixtureOverrides {
  readonly pattern?: string;
  readonly dataType?: RedisDataType;
  readonly estimatedBytes?: number;
  readonly estimatedKeyCount?: number;
  readonly keysWithTtl?: number;
  readonly keysWithoutTtl?: number;
  readonly medianTtlSeconds?: number | null;
  readonly bytesMeasured?: boolean;
  /** Defaults to `keysWithTtl + keysWithoutTtl`, so the sample stays internally consistent. */
  readonly sampledKeyCount?: number;
}

export function patternFixture(overrides: PatternFixtureOverrides = {}): KeyPatternStats {
  const estimatedKeyCount = overrides.estimatedKeyCount ?? 1_000;
  const estimatedBytes = overrides.estimatedBytes ?? 1_024 * 1_024;
  const keysWithTtl = overrides.keysWithTtl ?? 100;
  const keysWithoutTtl = overrides.keysWithoutTtl ?? 0;

  return {
    pattern: overrides.pattern ?? 'session:*',
    dataType: overrides.dataType ?? 'string',
    // Derived rather than fixed: a fixture claiming 100 sampled keys but only 5 with a TTL would
    // quietly exercise a state the sampler can never produce.
    sampledKeyCount: overrides.sampledKeyCount ?? keysWithTtl + keysWithoutTtl,
    sampledBytes: Math.round(estimatedBytes / 10),
    estimatedKeyCount,
    estimatedBytes,
    bytesMeasured: overrides.bytesMeasured ?? true,
    keysWithTtl,
    keysWithoutTtl,
    medianTtlSeconds: overrides.medianTtlSeconds === undefined ? 3_600 : overrides.medianTtlSeconds,
    exampleKeys: ['session:abc123'],
    estimateBasis: 'sampled-extrapolation',
  };
}

export interface SnapshotFixtureOverrides {
  readonly snapshotId?: string;
  readonly capturedAt?: string;
  /** `null` means `used_memory` was absent. `0` is a real resident-memory reading. */
  readonly usedMemoryBytes?: number | null;
  /** Total keys reported by `INFO keyspace`, which is measured rather than sampled. */
  readonly keyCount?: number;
  readonly patterns?: readonly KeyPatternStats[];
  readonly memory?: Partial<RedisMemoryFacts>;
  readonly instance?: Partial<RedisInstanceIdentity>;
  readonly sampling?: Partial<SamplingMetadata>;
}

/**
 * Builds a syntactically complete `RedisSnapshot` for tests.
 *
 * Hand-written fixtures rather than recorded output: `packages/evidence` is pure, so every
 * detector can be exercised against exact numbers with no Redis instance and no network.
 *
 * `usedMemoryDatasetBytes` defaults to 90% of `usedMemoryBytes` rather than equalling it, because
 * `selectGrowthMetric` reads exact equality across every snapshot as the sampler's fallback for a
 * server that does not report the dataset field.
 */
function scaleBytes(bytes: number | null, factor: number): number | null {
  return bytes === null ? null : Math.round(bytes * factor);
}

export function snapshotFixture(overrides: SnapshotFixtureOverrides = {}): RedisSnapshot {
  // `??` would treat an explicit 0 as missing and substitute the default.
  const usedMemoryBytes =
    overrides.usedMemoryBytes === undefined ? 64 * 1_024 * 1_024 : overrides.usedMemoryBytes;

  return {
    snapshotId: overrides.snapshotId ?? 'snapshot-1',
    capturedAt: overrides.capturedAt ?? '2026-08-25T10:00:00.000Z',
    instance: {
      redisVersion: '7.2.4',
      mode: 'standalone',
      role: 'master',
      maxmemoryBytes: 512 * 1_024 * 1_024,
      maxmemoryPolicy: 'noeviction',
      uptimeSeconds: 86_400,
      ...overrides.instance,
    },
    memory: {
      usedMemoryBytes,
      usedMemoryRssBytes: scaleBytes(usedMemoryBytes, 1.2),
      usedMemoryDatasetBytes: scaleBytes(usedMemoryBytes, 0.9),
      usedMemoryPeakBytes: usedMemoryBytes,
      memFragmentationRatio: 1.2,
      evictedKeys: 0,
      expiredKeys: 0,
      ...overrides.memory,
    },
    keyspace: [
      {
        db: 0,
        keyCount: overrides.keyCount ?? 10_000,
        keysWithExpiry: 9_000,
        averageTtlMs: 3_600_000,
      },
    ],
    patterns: overrides.patterns ?? [patternFixture()],
    sampling: {
      strategy: 'randomized-scan',
      requestedSampleSize: 1_000,
      observedSampleSize: 1_000,
      scanPasses: 10,
      effectiveSampleRate: 0.1,
      durationMs: 250,
      truncated: false,
      warnings: [],
      ...overrides.sampling,
    },
  };
}

/** Hours after the fixture epoch, as an ISO timestamp. Keeps series readable in tests. */
export function hoursIn(hours: number): string {
  return new Date(Date.UTC(2026, 7, 25, 10 + hours, 0, 0)).toISOString();
}

/**
 * A chronological series of snapshots from a list of `used_memory` values, one hour apart.
 * `patternsAt` supplies each snapshot's pattern statistics when a test needs them to move too.
 */
export function series(
  usedMemoryBytes: readonly number[],
  patternsAt?: (index: number) => readonly KeyPatternStats[],
): readonly RedisSnapshot[] {
  return usedMemoryBytes.map((bytes, index) =>
    snapshotFixture({
      snapshotId: `snapshot-${index + 1}`,
      capturedAt: hoursIn(index),
      usedMemoryBytes: bytes,
      ...(patternsAt === undefined ? {} : { patterns: patternsAt(index) }),
    }),
  );
}
