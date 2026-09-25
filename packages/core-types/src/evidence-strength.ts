/**
 * Qualitative bands are the ONLY way Redis Detective expresses how well-supported a
 * conclusion is. No percentages, no scores, no probabilities — see the confidence rule in
 * the root AGENTS.md. Adding a numeric field here is a hard-rule violation.
 */
export const EVIDENCE_STRENGTHS = ['strong', 'moderate', 'unclear'] as const;

export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export function isEvidenceStrength(value: unknown): value is EvidenceStrength {
  return typeof value === 'string' && (EVIDENCE_STRENGTHS as readonly string[]).includes(value);
}
