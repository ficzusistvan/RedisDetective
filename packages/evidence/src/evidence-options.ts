export const EVIDENCE_DEFAULTS = {
  /** Absolute growth below this is noise, not a finding. */
  minGrowthBytes: 8 * 1024 * 1024,
  /** Relative growth below this is noise, even when the absolute number looks large. */
  minGrowthRatio: 0.1,
  /** A single-interval jump at least this large is a step change rather than a trend. */
  stepChangeRatio: 0.25,
  /** Drop in TTL coverage (in absolute fraction) that counts as drift. */
  minTtlCoverageDrop: 0.1,
  /** A pattern must account for at least this share of an anomaly to be named. */
  minAttributionShare: 0.15,
  /** Cap on named patterns per anomaly, so a report stays readable. */
  maxAttributionsPerAnomaly: 5,
  /** Gap between consecutive snapshots beyond which the window is flagged as poorly observed. */
  maxSnapshotGapMs: 6 * 60 * 60 * 1000,
  /** Below this effective sample rate, attribution is reported as `unclear`. */
  minSampleRateForAttribution: 0.001,
} as const;

export interface EvidenceOptions {
  readonly minGrowthBytes?: number;
  readonly minGrowthRatio?: number;
  readonly stepChangeRatio?: number;
  readonly minTtlCoverageDrop?: number;
  readonly minAttributionShare?: number;
  readonly maxAttributionsPerAnomaly?: number;
  readonly maxSnapshotGapMs?: number;
  readonly minSampleRateForAttribution?: number;
}

export type ResolvedEvidenceOptions = Required<EvidenceOptions>;

export class EvidenceOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceOptionsError';
  }
}

const FRACTION_FIELDS = [
  'minGrowthRatio',
  'stepChangeRatio',
  'minTtlCoverageDrop',
  'minAttributionShare',
  'minSampleRateForAttribution',
] as const satisfies readonly (keyof EvidenceOptions)[];

/**
 * Applies defaults and rejects nonsensical thresholds.
 *
 * Thresholds are explicit options rather than constants inside the detectors so that they can be
 * varied in tests and, later, tuned per instance size without touching detection logic. They are
 * validated strictly rather than clamped: unlike the sampler's bounds, a bad threshold here has no
 * safe interpretation, and silently substituting one would make a detector's output impossible to
 * reason about.
 */
export function resolveEvidenceOptions(options: EvidenceOptions = {}): ResolvedEvidenceOptions {
  const resolved: ResolvedEvidenceOptions = {
    minGrowthBytes: options.minGrowthBytes ?? EVIDENCE_DEFAULTS.minGrowthBytes,
    minGrowthRatio: options.minGrowthRatio ?? EVIDENCE_DEFAULTS.minGrowthRatio,
    stepChangeRatio: options.stepChangeRatio ?? EVIDENCE_DEFAULTS.stepChangeRatio,
    minTtlCoverageDrop: options.minTtlCoverageDrop ?? EVIDENCE_DEFAULTS.minTtlCoverageDrop,
    minAttributionShare: options.minAttributionShare ?? EVIDENCE_DEFAULTS.minAttributionShare,
    maxAttributionsPerAnomaly:
      options.maxAttributionsPerAnomaly ?? EVIDENCE_DEFAULTS.maxAttributionsPerAnomaly,
    maxSnapshotGapMs: options.maxSnapshotGapMs ?? EVIDENCE_DEFAULTS.maxSnapshotGapMs,
    minSampleRateForAttribution:
      options.minSampleRateForAttribution ?? EVIDENCE_DEFAULTS.minSampleRateForAttribution,
  };

  for (const [field, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value)) {
      throw new EvidenceOptionsError(
        `${field} must be a finite number, received ${String(value)}.`,
      );
    }
    if (value < 0) {
      throw new EvidenceOptionsError(`${field} must not be negative, received ${value}.`);
    }
  }

  for (const field of FRACTION_FIELDS) {
    const value = resolved[field];
    if (value > 1) {
      throw new EvidenceOptionsError(`${field} is a fraction in [0, 1], received ${value}.`);
    }
  }

  if (!Number.isInteger(resolved.maxAttributionsPerAnomaly)) {
    throw new EvidenceOptionsError(
      `maxAttributionsPerAnomaly must be an integer, received ${resolved.maxAttributionsPerAnomaly}.`,
    );
  }

  return resolved;
}
