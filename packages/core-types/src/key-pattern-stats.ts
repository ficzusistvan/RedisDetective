export const REDIS_DATA_TYPES = [
  'string',
  'list',
  'set',
  'zset',
  'hash',
  'stream',
  'unknown',
] as const;

export type RedisDataType = (typeof REDIS_DATA_TYPES)[number];

/**
 * Whether the numbers on a `KeyPatternStats` were measured or extrapolated from a sample.
 * Almost always `'sampled-extrapolation'`, because the sampler is forbidden from walking the
 * whole key space. User-facing output must not present an extrapolation as a measurement.
 */
export type EstimateBasis = 'sampled-extrapolation' | 'exact';

/**
 * Aggregated view of one key pattern (e.g. `session:*`), derived from sampled keys.
 *
 * A "pattern" is a key with its high-cardinality segments replaced by `*`, so that
 * `session:8f2a1c` and `session:0b91de` collapse into `session:*`. Attribution happens at this
 * level because that is the level at which a human can recognise their own code.
 */
export interface KeyPatternStats {
  readonly pattern: string;
  readonly dataType: RedisDataType;

  /** Keys matching this pattern that were actually visited during sampling. */
  readonly sampledKeyCount: number;
  /** Sum of `MEMORY USAGE` over the sampled keys only. */
  readonly sampledBytes: number;

  /** Sample count scaled up to the reported key-space size. An estimate. */
  readonly estimatedKeyCount: number;
  /** Sampled bytes scaled up to the reported key-space size. An estimate. */
  readonly estimatedBytes: number;

  /**
   * Whether any byte figure could be obtained at all. `false` when `MEMORY USAGE` was unavailable,
   * which managed Redis providers do enforce.
   *
   * Without this flag the byte fields would be zero, and a consumer could not tell "this pattern
   * holds no data" from "nobody could measure this pattern" — so a report would show a multi-
   * gigabyte pattern as `0 B`, and any share computed from bytes would silently become zero.
   * Callers must fall back to key counts when this is `false`.
   */
  readonly bytesMeasured: boolean;

  readonly keysWithTtl: number;
  readonly keysWithoutTtl: number;
  /** Median remaining TTL across sampled keys that have one; `null` when none do. */
  readonly medianTtlSeconds: number | null;

  /** A handful of real keys, for the report. Must be redaction-safe before display. */
  readonly exampleKeys: readonly string[];
  readonly estimateBasis: EstimateBasis;
}
