/**
 * Sampling knobs shared by the programmatic health check, snapshot save, and diagnosis.
 *
 * Omitted fields leave the sampler defaults (then clamped by `resolveSamplerOptions`). These are
 * the same flags as `--sample-size`, `--timeout`, `--memory-samples`, `--databases`, and
 * `--redact-keys`.
 */
export interface LibrarySamplingOptions {
  /** Keys to sample. Clamped to a safe ceiling. */
  readonly sampleSize?: number;
  /** Wall-clock budget for sampling, in milliseconds. Clamped to a safe ceiling. */
  readonly timeoutMs?: number;
  /** `SAMPLES` for `MEMORY USAGE` on nested values. Clamped to a safe ceiling. */
  readonly memorySamples?: number;
  /** Database indexes to sample. Defaults to `[0]`. */
  readonly databases?: readonly number[];
  /** Replace example key names with a placeholder, for a report that will be shared. */
  readonly redactKeys?: boolean;
}

/**
 * The sampling fields as `runHealthCheck` / `runDiagnosis` / `captureSnapshot` expect them:
 * every key present, with `null` meaning "leave the sampler default".
 */
export interface CapturedSamplingFields {
  readonly sampleSize: number | null;
  readonly timeoutMs: number | null;
  readonly memorySamples: number | null;
  readonly databases: readonly number[] | null;
  readonly redactKeys: boolean;
}

export function capturedSamplingFields(options: LibrarySamplingOptions): CapturedSamplingFields {
  return {
    sampleSize: options.sampleSize ?? null,
    timeoutMs: options.timeoutMs ?? null,
    memorySamples: options.memorySamples ?? null,
    databases: options.databases ?? null,
    redactKeys: options.redactKeys === true,
  };
}
