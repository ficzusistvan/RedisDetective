/**
 * Absolute ceilings, applied by clamping rather than by validation.
 *
 * A caller cannot exceed these, and there is no override flag — see this package's AGENTS.md for
 * why an escape hatch here would be a hard-rule violation.
 */
export const SAMPLER_HARD_LIMITS = {
  /** Never visit more than this many keys in a single snapshot, whatever the caller asks for. */
  maxSampledKeys: 10_000,
  /** Cursor iterations per database. Bounds work even when each pass returns few keys. */
  maxScanPasses: 200,
  /** `COUNT` per SCAN call. Large values make one call expensive on the single Redis thread. */
  maxScanCount: 500,
  /** Wall-clock deadline for the whole snapshot. */
  maxDurationMs: 30_000,
  /** `SAMPLES` for MEMORY USAGE on nested types. */
  maxMemoryUsageSamples: 10,
  /**
   * Cap on the fraction of a large key space visited, so sampling cost scales with instance size
   * rather than being flat. A key space smaller than `maxSampledKeys` is visited in full instead,
   * since that is both cheap and exact.
   */
  maxSampleRate: 0.25,
} as const;

export const SAMPLER_DEFAULTS = {
  maxSampledKeys: 1_000,
  maxScanPasses: 50,
  scanCount: 100,
  maxDurationMs: 10_000,
  memoryUsageSamples: 5,
  maxSampleRate: 0.1,
  /** Segments kept before collapsing to `*`: `session:user:42` at depth 2 → `session:user:*`. */
  patternDepth: 2,
  databases: [0] as readonly number[],
} as const;

export interface SamplerOptions {
  readonly maxSampledKeys?: number;
  readonly maxScanPasses?: number;
  readonly scanCount?: number;
  readonly maxDurationMs?: number;
  readonly memoryUsageSamples?: number;
  readonly maxSampleRate?: number;
  readonly patternDepth?: number;
  readonly databases?: readonly number[];
}

export interface ResolvedSamplerOptions {
  readonly maxSampledKeys: number;
  readonly maxScanPasses: number;
  readonly scanCount: number;
  readonly maxDurationMs: number;
  readonly memoryUsageSamples: number;
  readonly maxSampleRate: number;
  readonly patternDepth: number;
  readonly databases: readonly number[];
  /** Records every clamp applied, so it can be surfaced in `SamplingMetadata.warnings`. */
  readonly clamped: readonly string[];
}

export class SamplerOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SamplerOptionsError';
  }
}

interface BoundedNumberSpec {
  readonly name: keyof SamplerOptions;
  readonly value: number | undefined;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
}

function resolveBounded(spec: BoundedNumberSpec, clamped: string[]): number {
  const raw = spec.value ?? spec.fallback;

  if (!Number.isFinite(raw)) {
    throw new SamplerOptionsError(`${spec.name} must be a finite number, received ${String(raw)}.`);
  }
  if (raw <= 0) {
    throw new SamplerOptionsError(`${spec.name} must be greater than 0, received ${raw}.`);
  }
  if (spec.integer && !Number.isInteger(raw)) {
    throw new SamplerOptionsError(`${spec.name} must be an integer, received ${raw}.`);
  }

  if (raw > spec.max) {
    clamped.push(`${spec.name} reduced from ${raw} to the hard limit of ${spec.max}`);
    return spec.max;
  }
  if (raw < spec.min) {
    clamped.push(`${spec.name} raised from ${raw} to the minimum of ${spec.min}`);
    return spec.min;
  }
  return raw;
}

function resolveDatabases(databases: readonly number[] | undefined, clamped: string[]): number[] {
  const requested = databases ?? SAMPLER_DEFAULTS.databases;

  if (requested.length === 0) {
    throw new SamplerOptionsError('databases must list at least one database index.');
  }
  for (const db of requested) {
    if (!Number.isInteger(db) || db < 0) {
      throw new SamplerOptionsError(`databases must contain non-negative integers, found ${db}.`);
    }
  }

  const deduplicated = [...new Set(requested)].sort((left, right) => left - right);
  if (deduplicated.length !== requested.length) {
    clamped.push('duplicate database indexes were removed');
  }
  return deduplicated;
}

/**
 * Normalises caller options against `SAMPLER_HARD_LIMITS`.
 *
 * Out-of-range values are clamped, not rejected, so that a caller passing `--sample-size 5000000`
 * still gets a safe snapshot plus a warning rather than an error or a stampede. Structurally
 * invalid values (negative, non-integer, empty database list) do throw, since those indicate a
 * bug rather than an over-ambitious request.
 */
export function resolveSamplerOptions(options: SamplerOptions = {}): ResolvedSamplerOptions {
  const clamped: string[] = [];

  const resolved: Omit<ResolvedSamplerOptions, 'clamped'> = {
    maxSampledKeys: resolveBounded(
      {
        name: 'maxSampledKeys',
        value: options.maxSampledKeys,
        fallback: SAMPLER_DEFAULTS.maxSampledKeys,
        min: 1,
        max: SAMPLER_HARD_LIMITS.maxSampledKeys,
        integer: true,
      },
      clamped,
    ),
    maxScanPasses: resolveBounded(
      {
        name: 'maxScanPasses',
        value: options.maxScanPasses,
        fallback: SAMPLER_DEFAULTS.maxScanPasses,
        min: 1,
        max: SAMPLER_HARD_LIMITS.maxScanPasses,
        integer: true,
      },
      clamped,
    ),
    scanCount: resolveBounded(
      {
        name: 'scanCount',
        value: options.scanCount,
        fallback: SAMPLER_DEFAULTS.scanCount,
        min: 1,
        max: SAMPLER_HARD_LIMITS.maxScanCount,
        integer: true,
      },
      clamped,
    ),
    maxDurationMs: resolveBounded(
      {
        name: 'maxDurationMs',
        value: options.maxDurationMs,
        fallback: SAMPLER_DEFAULTS.maxDurationMs,
        min: 100,
        max: SAMPLER_HARD_LIMITS.maxDurationMs,
        integer: true,
      },
      clamped,
    ),
    memoryUsageSamples: resolveBounded(
      {
        name: 'memoryUsageSamples',
        value: options.memoryUsageSamples,
        fallback: SAMPLER_DEFAULTS.memoryUsageSamples,
        min: 1,
        max: SAMPLER_HARD_LIMITS.maxMemoryUsageSamples,
        integer: true,
      },
      clamped,
    ),
    maxSampleRate: resolveBounded(
      {
        name: 'maxSampleRate',
        value: options.maxSampleRate,
        fallback: SAMPLER_DEFAULTS.maxSampleRate,
        min: 0.000_01,
        max: SAMPLER_HARD_LIMITS.maxSampleRate,
        integer: false,
      },
      clamped,
    ),
    patternDepth: resolveBounded(
      {
        name: 'patternDepth',
        value: options.patternDepth,
        fallback: SAMPLER_DEFAULTS.patternDepth,
        min: 1,
        max: 8,
        integer: true,
      },
      clamped,
    ),
    databases: resolveDatabases(options.databases, clamped),
  };

  return { ...resolved, clamped };
}
