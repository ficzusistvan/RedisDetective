import type { RedisSnapshot } from '@redis-detective/core-types';

/**
 * Rebuilds a snapshot as a JSON-safe object with a stable key order.
 *
 * Used by the health-check JSON report, the diagnosis JSON report, and the on-disk snapshot
 * files, so the three cannot drift apart. Extra internal fields cannot leak just by being added
 * to `RedisSnapshot`.
 */
export function serializeSnapshot(snapshot: RedisSnapshot): RedisSnapshot {
  return {
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    instance: {
      redisVersion: snapshot.instance.redisVersion,
      mode: snapshot.instance.mode,
      role: snapshot.instance.role,
      maxmemoryBytes: snapshot.instance.maxmemoryBytes,
      maxmemoryPolicy: snapshot.instance.maxmemoryPolicy,
      uptimeSeconds: snapshot.instance.uptimeSeconds,
    },
    memory: {
      usedMemoryBytes: snapshot.memory.usedMemoryBytes,
      usedMemoryRssBytes: snapshot.memory.usedMemoryRssBytes,
      usedMemoryDatasetBytes: snapshot.memory.usedMemoryDatasetBytes,
      usedMemoryPeakBytes: snapshot.memory.usedMemoryPeakBytes,
      memFragmentationRatio: snapshot.memory.memFragmentationRatio,
      evictedKeys: snapshot.memory.evictedKeys,
      expiredKeys: snapshot.memory.expiredKeys,
    },
    keyspace: snapshot.keyspace.map((entry) => ({
      db: entry.db,
      keyCount: entry.keyCount,
      keysWithExpiry: entry.keysWithExpiry,
      averageTtlMs: entry.averageTtlMs,
    })),
    patterns: snapshot.patterns.map((pattern) => ({
      pattern: pattern.pattern,
      dataType: pattern.dataType,
      sampledKeyCount: pattern.sampledKeyCount,
      sampledBytes: pattern.sampledBytes,
      estimatedKeyCount: pattern.estimatedKeyCount,
      estimatedBytes: pattern.estimatedBytes,
      bytesMeasured: pattern.bytesMeasured,
      keysWithTtl: pattern.keysWithTtl,
      keysWithoutTtl: pattern.keysWithoutTtl,
      medianTtlSeconds: pattern.medianTtlSeconds,
      exampleKeys: pattern.exampleKeys,
      estimateBasis: pattern.estimateBasis,
    })),
    sampling: {
      strategy: snapshot.sampling.strategy,
      requestedSampleSize: snapshot.sampling.requestedSampleSize,
      observedSampleSize: snapshot.sampling.observedSampleSize,
      scanPasses: snapshot.sampling.scanPasses,
      effectiveSampleRate: snapshot.sampling.effectiveSampleRate,
      durationMs: snapshot.sampling.durationMs,
      truncated: snapshot.sampling.truncated,
      warnings: snapshot.sampling.warnings,
    },
  };
}
