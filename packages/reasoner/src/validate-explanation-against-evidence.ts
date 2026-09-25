import type { EvidenceKind, EvidenceStrength, Explanation } from '@redis-detective/core-types';

import { collectCitableEvidenceIds } from './reasoner-input.js';
import type { ReasonerInput } from './reasoner-input.js';

export const EXPLANATION_VIOLATION_KINDS = [
  /** A citation points at an evidence id that is not in the graph. */
  'unknown-evidence-id',
  /** A named cause references a pattern that appears in no attribution or drift event. */
  'unsupported-pattern',
  /** A hinted candidate SHA was not among the supplied Commit candidates. */
  'unsupported-commit',
  /** A substantive claim carries no citation at all. */
  'uncited-claim',
  /** Output contains a percentage, probability or score — see the confidence rule. */
  'numeric-confidence-claim',
  /** Claimed strength exceeds what the underlying evidence supports. */
  'strength-overstated',
] as const;

export type ExplanationViolationKind = (typeof EXPLANATION_VIOLATION_KINDS)[number];

export interface ExplanationViolation {
  readonly kind: ExplanationViolationKind;
  readonly detail: string;
  /** The offending fragment, so a caller can drop just that claim. */
  readonly offendingText: string | null;
}

export interface ExplanationValidationResult {
  readonly valid: boolean;
  readonly violations: readonly ExplanationViolation[];
}

const STRENGTH_RANK: Record<EvidenceStrength, number> = {
  unclear: 0,
  moderate: 1,
  strong: 2,
};

const NUMERIC_CONFIDENCE =
  /(\d+(?:\.\d+)?%\s*(?:sure|confident|confidence|likely|chance|probability)|confidence score|\b\d+\s*(?:out of|\/)\s*100\b|\b\d+(?:\.\d+)?%\s*(?:probability|chance)\b)/i;

/**
 * Checks a generated explanation against the evidence it was supposed to be based on.
 *
 * This is the mechanism that turns "never invent causes" from a prompt instruction into an
 * enforced property. Model output is untrusted input: prompts are a request, this is the check.
 */
export function validateExplanationAgainstEvidence(
  explanation: Explanation,
  input: ReasonerInput,
): ExplanationValidationResult {
  const violations: ExplanationViolation[] = [];
  const citable = collectCitableEvidenceIds(input);
  const allowedPatterns = new Set([
    ...input.graph.attributions.map((attribution) => attribution.pattern),
    ...input.graph.ttlDrift.map((event) => event.pattern),
  ]);
  const allowedCommitShas = new Set(input.commitCandidates.map((candidate) => candidate.sha));

  const citations = [
    ...explanation.supportingEvidence,
    ...(explanation.likelyCause === null ? [] : explanation.likelyCause.citations),
  ];

  for (const citation of citations) {
    if (!citable.has(citation.evidenceId)) {
      violations.push({
        kind: 'unknown-evidence-id',
        detail: `Citation evidenceId "${citation.evidenceId}" is not in the supplied evidence.`,
        offendingText: citation.evidenceId,
      });
    }
  }

  if (explanation.likelyCause !== null) {
    if (!allowedPatterns.has(explanation.likelyCause.pattern)) {
      violations.push({
        kind: 'unsupported-pattern',
        detail: `likelyCause.pattern "${explanation.likelyCause.pattern}" does not appear in any attribution or TTL drift event.`,
        offendingText: explanation.likelyCause.pattern,
      });
    }
    if (explanation.likelyCause.citations.length === 0) {
      violations.push({
        kind: 'uncited-claim',
        detail: 'likelyCause has no citations.',
        offendingText: explanation.likelyCause.description,
      });
    }
  }

  for (const sha of explanation.hintedCandidateShas) {
    if (!allowedCommitShas.has(sha)) {
      violations.push({
        kind: 'unsupported-commit',
        detail: `hintedCandidateSha "${sha}" is not among the supplied Commit candidates.`,
        offendingText: sha,
      });
    }
  }

  const prose = collectProse(explanation);
  const confidenceMatch = NUMERIC_CONFIDENCE.exec(prose);
  if (confidenceMatch !== null) {
    violations.push({
      kind: 'numeric-confidence-claim',
      detail: 'Explanation uses numeric confidence phrasing, which this product does not emit.',
      offendingText: confidenceMatch[0] ?? null,
    });
  }

  const cap = maxSupportedStrength(explanation, input);
  if (STRENGTH_RANK[explanation.evidenceStrength] > STRENGTH_RANK[cap]) {
    violations.push({
      kind: 'strength-overstated',
      detail: `evidenceStrength "${explanation.evidenceStrength}" exceeds the supporting evidence (${cap}).`,
      offendingText: explanation.evidenceStrength,
    });
  }

  return { valid: violations.length === 0, violations };
}

function collectProse(explanation: Explanation): string {
  const parts = [
    explanation.headline,
    explanation.summary,
    ...explanation.recommendedActions,
    ...explanation.unknowns,
    ...explanation.supportingEvidence.map((citation) => citation.statement),
  ];
  if (explanation.likelyCause !== null) {
    parts.push(explanation.likelyCause.description);
    parts.push(...explanation.likelyCause.citations.map((citation) => citation.statement));
  }
  return parts.join('\n');
}

function maxSupportedStrength(explanation: Explanation, input: ReasonerInput): EvidenceStrength {
  if (explanation.likelyCause === null) {
    return 'unclear';
  }

  const matching = input.graph.attributions.filter(
    (attribution) => attribution.pattern === explanation.likelyCause?.pattern,
  );
  const drift = input.graph.ttlDrift.filter(
    (event) => event.pattern === explanation.likelyCause?.pattern,
  );
  const citedAnomalies = input.graph.anomalies.filter((anomaly) =>
    explanation.likelyCause?.citations.some(
      (citation) => citation.kind === 'anomaly' && citation.evidenceId === anomaly.eventId,
    ),
  );

  const strengths: EvidenceStrength[] = [
    ...matching.map((attribution) => attribution.evidenceStrength),
    ...drift.map((event) => event.evidenceStrength),
    ...citedAnomalies.map((anomaly) => anomaly.evidenceStrength),
  ];
  if (strengths.length === 0) {
    return 'unclear';
  }
  return strengths.reduce(
    (weakest, next) => (STRENGTH_RANK[next] < STRENGTH_RANK[weakest] ? next : weakest),
    strengths[0] ?? 'unclear',
  );
}

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return (
    value === 'anomaly' ||
    value === 'attribution' ||
    value === 'ttl-drift' ||
    value === 'commit' ||
    value === 'gap'
  );
}
