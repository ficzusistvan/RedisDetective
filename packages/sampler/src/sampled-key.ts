import type { RedisDataType } from '@redis-detective/core-types';

/**
 * One key that the bounded sample actually visited.
 *
 * The intermediate representation between `scanKeySample` and `aggregateKeyPatterns`. Keys reach
 * this shape only by being selected by a bounded SCAN, which is what makes the per-key
 * `MEMORY USAGE` call behind `serializedBytes` safe.
 */
export interface SampledKey {
  readonly key: string;
  readonly db: number;
  readonly dataType: RedisDataType;
  /** `MEMORY USAGE` for this one key; `null` if the key expired mid-sample. */
  readonly serializedBytes: number | null;
  /** Remaining TTL in ms; `null` means no expiry is set — the interesting case for TTL drift. */
  readonly ttlMs: number | null;
}
