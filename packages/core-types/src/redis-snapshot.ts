import type { KeyPatternStats } from './key-pattern-stats.js';

export type RedisDeploymentMode = 'standalone' | 'cluster' | 'sentinel' | 'unknown';

export type RedisRole = 'master' | 'replica' | 'unknown';

export interface RedisInstanceIdentity {
  readonly redisVersion: string;
  readonly mode: RedisDeploymentMode;
  readonly role: RedisRole;
  /** `null` when `maxmemory` is 0/unset, i.e. no configured ceiling. */
  readonly maxmemoryBytes: number | null;
  readonly maxmemoryPolicy: string;
  readonly uptimeSeconds: number;
}

/**
 * Straight from `INFO memory` / `INFO stats`. Measured, not sampled.
 *
 * A byte counter is `null` when that field was absent from `INFO`. A present `0` stays `0`: it is
 * a real reading of resident allocator memory, and collapsing the two would make a later sample
 * unable to tell "the field was missing" from "nothing is in RAM".
 */
export interface RedisMemoryFacts {
  readonly usedMemoryBytes: number | null;
  readonly usedMemoryRssBytes: number | null;
  readonly usedMemoryDatasetBytes: number | null;
  readonly usedMemoryPeakBytes: number | null;
  readonly memFragmentationRatio: number;
  readonly evictedKeys: number;
  readonly expiredKeys: number;
}

/** Per-database `INFO keyspace` line: `db0:keys=1,expires=0,avg_ttl=0`. */
export interface RedisKeyspaceFacts {
  readonly db: number;
  readonly keyCount: number;
  readonly keysWithExpiry: number;
  readonly averageTtlMs: number | null;
}

/**
 * What the sampler actually did. Present on every snapshot so downstream code can tell how much
 * weight the pattern statistics deserve, and so a report can be honest about its own limits.
 */
export interface SamplingMetadata {
  readonly strategy: 'randomized-scan';
  readonly requestedSampleSize: number;
  readonly observedSampleSize: number;
  readonly scanPasses: number;
  /** Observed sample size divided by total keys in the sampled databases, in `[0, 1]`. */
  readonly effectiveSampleRate: number;
  readonly durationMs: number;
  /** True when a hard bound (key ceiling, pass ceiling or deadline) stopped sampling early. */
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}

/**
 * One point-in-time observation of a Redis instance: measured `INFO` facts plus sampled
 * per-pattern statistics. The unit of input to `packages/evidence`.
 */
export interface RedisSnapshot {
  readonly snapshotId: string;
  /** ISO-8601 UTC. */
  readonly capturedAt: string;
  readonly instance: RedisInstanceIdentity;
  readonly memory: RedisMemoryFacts;
  readonly keyspace: readonly RedisKeyspaceFacts[];
  readonly patterns: readonly KeyPatternStats[];
  readonly sampling: SamplingMetadata;
}
