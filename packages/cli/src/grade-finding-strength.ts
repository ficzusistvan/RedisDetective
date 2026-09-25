import type { EstimateBasis, EvidenceStrength } from '@redis-detective/core-types';

export interface FindingStrengthInput {
  /** Share of the key space the snapshot actually visited. */
  readonly effectiveSampleRate: number;
  readonly sampleTruncated: boolean;
  /** `'exact'` means the whole key space was visited, so the figures are measured. */
  readonly estimateBasis: EstimateBasis;
  /** Sampled keys behind this particular finding, not the snapshot as a whole. */
  readonly sampledKeyCount: number;
}

/** Below this, a handful of keys swings the numbers too far to support any claim. */
const MIN_SAMPLED_KEYS_FOR_A_CLAIM = 20;
const STRONG_SAMPLE_RATE = 0.05;
const STRONG_SAMPLED_KEYS = 100;
const MODERATE_SAMPLE_RATE = 0.005;

/**
 * Grades a single-snapshot finding onto a qualitative band.
 *
 * The single-snapshot counterpart to `gradeEvidenceStrength` in `packages/evidence`, which answers
 * a different question: that one grades a *causal* claim across several snapshots, this one grades
 * a *descriptive* claim about one. They are kept separate rather than shared because a strong
 * description of current state is not evidence of a cause, and blurring the two is how a health
 * check starts making claims it cannot support.
 *
 * Returns a band and nothing else. There is deliberately no numeric variant, so no caller can leak
 * a score into user output — see the confidence rule in the root AGENTS.md.
 */
export function gradeFindingStrength(input: FindingStrengthInput): EvidenceStrength {
  // Measured, not extrapolated: the sampler visited every key.
  if (input.estimateBasis === 'exact' && !input.sampleTruncated) {
    return 'strong';
  }
  if (input.sampledKeyCount < MIN_SAMPLED_KEYS_FOR_A_CLAIM || input.sampleTruncated) {
    return 'unclear';
  }
  if (
    input.effectiveSampleRate >= STRONG_SAMPLE_RATE &&
    input.sampledKeyCount >= STRONG_SAMPLED_KEYS
  ) {
    return 'strong';
  }
  if (input.effectiveSampleRate >= MODERATE_SAMPLE_RATE) {
    return 'moderate';
  }
  return 'unclear';
}

/**
 * Strength for a finding read straight from `INFO`.
 *
 * `used_memory`, `maxmemory` and `evicted_keys` are measured counters, not extrapolations, so a
 * finding built only from them does not inherit the sample's uncertainty.
 */
export function measuredFindingStrength(): EvidenceStrength {
  return 'strong';
}
