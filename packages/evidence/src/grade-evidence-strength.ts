import type { EvidenceStrength } from '@redis-detective/core-types';

/**
 * The observable inputs to a strength judgement. Everything here is a count, a fraction or a
 * boolean the caller actually measured — no priors, no weights, no learned parameters.
 */
export interface EvidenceStrengthInput {
  /** How many snapshots support the finding. One snapshot can never establish growth. */
  readonly supportingSnapshotCount: number;
  /** Effective sample rate behind the finding; thin samples cannot support a firm claim. */
  readonly effectiveSampleRate: number;
  /** Share of the anomaly this finding accounts for, in `[0, 1]`. */
  readonly shareOfGrowth: number;
  /** True when a bound cut sampling short in any contributing snapshot. */
  readonly sampleTruncated: boolean;
  /** True when a corroborating signal agrees (e.g. TTL drift alongside key-count growth). */
  readonly hasCorroboratingSignal: boolean;
}

/** Two snapshots are the minimum that can show a change at all. */
const MIN_SNAPSHOTS_FOR_MODERATE = 2;
/** A third snapshot is what separates a trend from a coincidence of timing. */
const MIN_SNAPSHOTS_FOR_STRONG = 3;
/** A finding must account for most of what it claims to explain. */
const MAJORITY_SHARE = 0.5;
/**
 * Sample rates below this cannot support any claim about pattern-level behaviour. Mirrors
 * `EVIDENCE_DEFAULTS.minSampleRateForAttribution`; it is duplicated rather than threaded through
 * because this function takes only measurements, so that its output depends on nothing but its
 * arguments and every branch is reachable from a unit test.
 */
const MIN_USABLE_SAMPLE_RATE = 0.001;

/**
 * Maps measured evidence onto one of the three qualitative bands.
 *
 * This function exists so that the confidence rule is enforced in exactly one place: it returns an
 * `EvidenceStrength` and there is no numeric variant, so no caller can leak a score into user
 * output. Do not add one — see the confidence rule in the root AGENTS.md. The thresholds below are
 * a deliberate, reviewable judgement, not a calibrated model, and they stay that way until we have
 * real accuracy data from user feedback.
 *
 * The table errs toward understatement at every step. Given a choice between calling weak evidence
 * moderate and calling good evidence unclear, it takes the second: a user who is told the evidence
 * is thin goes and collects more, whereas a user who is told a guess is solid acts on it.
 *
 * Callers whose finding rests on measured `INFO` counters rather than on the key sample should pass
 * `effectiveSampleRate: 1`, since the sample does not bear on those numbers.
 */
export function gradeEvidenceStrength(input: EvidenceStrengthInput): EvidenceStrength {
  // Guard first: a non-finite input means a caller divided by zero somewhere, and inventing a band
  // from a NaN is exactly the sort of confident nonsense this function exists to prevent.
  if (!Number.isFinite(input.shareOfGrowth) || !Number.isFinite(input.effectiveSampleRate)) {
    return 'unclear';
  }

  // One snapshot describes a state. It cannot establish a change, whatever else is true.
  if (input.supportingSnapshotCount < MIN_SNAPSHOTS_FOR_MODERATE) {
    return 'unclear';
  }

  if (input.effectiveSampleRate < MIN_USABLE_SAMPLE_RATE) {
    return 'unclear';
  }

  if (input.shareOfGrowth < MAJORITY_SHARE) {
    return 'unclear';
  }

  const isStrong =
    input.supportingSnapshotCount >= MIN_SNAPSHOTS_FOR_STRONG &&
    !input.sampleTruncated &&
    input.hasCorroboratingSignal;

  return isStrong ? 'strong' : 'moderate';
}
