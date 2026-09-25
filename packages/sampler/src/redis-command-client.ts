export interface ScanRequest {
  readonly cursor: string;
  /** Hint for how much work Redis does per call. Keep this small; see AGENTS.md. */
  readonly count: number;
  readonly type?: string;
}

export interface ScanResponse {
  readonly cursor: string;
  readonly keys: readonly string[];
}

export interface MemoryUsageRequest {
  /** `SAMPLES` argument for nested types. Low values keep the call cheap. */
  readonly samples: number;
}

/**
 * The only Redis surface the sampler is allowed to touch.
 *
 * This interface is intentionally narrow: it is the type-level expression of the safety rule in
 * this package's AGENTS.md. There is deliberately no `keys()`, no `flushdb()`, no `eval()`, and no
 * generic `command(...)` escape hatch. Adding one would let a future change bypass the bounds
 * enforced in `resolveSamplerOptions`, so don't.
 *
 * Implementations adapt whichever client library the caller uses (`redis`, `ioredis`, a fake in
 * tests). Keeping it injected is also what lets every sampler test run with no Redis instance.
 */
export interface RedisCommandClient {
  /** `INFO [section]` — O(1). */
  info(section?: string): Promise<string>;

  /** `SELECT db`. Needed to sample logical databases other than 0. */
  select(db: number): Promise<void>;

  /** `DBSIZE` — O(1). Used to scale a sample up to the key space. */
  dbSize(): Promise<number>;

  /** `SCAN cursor COUNT n [TYPE t]` — cursor-bounded, never called without a cap on passes. */
  scan(request: ScanRequest): Promise<ScanResponse>;

  /** `TYPE key` — O(1), one sampled key at a time. */
  type(key: string): Promise<string>;

  /** `PTTL key` — O(1). Returns `null` when the key has no expiry. */
  pttl(key: string): Promise<number | null>;

  /**
   * `MEMORY USAGE key SAMPLES n` — O(1)-ish for a single key.
   * Legal only for keys already chosen by the bounded sample. Returns `null` if the key vanished.
   */
  memoryUsage(key: string, request: MemoryUsageRequest): Promise<number | null>;
}
