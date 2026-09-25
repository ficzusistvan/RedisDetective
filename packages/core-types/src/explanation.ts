import type { EvidenceStrength } from './evidence-strength.js';

export type EvidenceKind = 'anomaly' | 'attribution' | 'ttl-drift' | 'commit' | 'gap';

/**
 * A single sentence in an explanation, bound to the evidence node that licenses it.
 *
 * Every substantive claim the reasoner makes must carry one of these, and `evidenceId` must
 * resolve to a node that already exists in the `EvidenceGraph` (or to a supplied commit SHA).
 * This is the mechanism that makes "never invent causes" checkable rather than aspirational.
 */
export interface ExplanationCitation {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  readonly statement: string;
}

/**
 * Redis-side Cause wording only. Commit candidate SHAs live on `Explanation.hintedCandidateShas`,
 * not here — nesting them under the cause smuggled ownership language past the glossary.
 */
export interface ExplanationCause {
  readonly pattern: string;
  readonly description: string;
  readonly citations: readonly ExplanationCitation[];
}

export interface LlmAttribution {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
}

/**
 * The user-facing answer. Prose over evidence — it adds wording, never facts.
 */
export interface Explanation {
  readonly explanationId: string;
  /** ISO-8601 UTC. */
  readonly generatedAt: string;
  readonly graphId: string;

  readonly headline: string;
  readonly summary: string;
  /** `null` when the evidence does not support naming a cause. That is a valid answer. */
  readonly likelyCause: ExplanationCause | null;
  /**
   * Commit-candidate SHAs with a Pattern hint for the named Cause, drawn from the supplied
   * `GitCommitCandidate[]`. Never synthesised. Sibling of `likelyCause` on purpose: these are
   * Commit candidates for a human look — never part of the Cause.
   */
  readonly hintedCandidateShas: readonly string[];
  readonly supportingEvidence: readonly ExplanationCitation[];
  readonly recommendedActions: readonly string[];

  /** Qualitative only. See the confidence rule in AGENTS.md. */
  readonly evidenceStrength: EvidenceStrength;
  /** What could not be determined, and why. Rendered to the user, not hidden. */
  readonly unknowns: readonly string[];

  /** `null` when the explanation was produced without an LLM (deterministic fallback wording). */
  readonly model: LlmAttribution | null;
}
