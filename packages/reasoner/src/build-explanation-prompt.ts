import type { LlmCompletionRequest } from './llm-client.js';
import type { ReasonerInput } from './reasoner-input.js';
import { gapEvidenceId } from './reasoner-input.js';

/**
 * Bump whenever the prompt text changes, so an `Explanation` can be traced to the prompt that
 * produced it. Recorded in `LlmAttribution.promptVersion`.
 */
export const PROMPT_VERSION = '2026-09-25.1';

const SYSTEM_PROMPT = `You translate an EvidenceGraph into a JSON explanation for an on-call engineer.

Rules you must follow:
- Restate and summarise only the supplied evidence. Do not add Redis lore, typical causes, or guesses.
- likelyCause names a Redis key pattern only. If the evidence does not name a pattern, set likelyCause to null and list what is missing in unknowns. Commits are never Causes.
- Every claim needs a citation whose evidenceId appears in the evidence block.
- hintedCandidateShas is a top-level field (sibling of likelyCause). It may only contain SHAs listed under COMMIT CANDIDATES. Never nest commit SHAs under likelyCause. Never treat any commit as a Cause.
- evidenceStrength must be one of: strong, moderate, unclear. Never a number, percentage, probability, or score.
- Do not write phrases like "87% sure", "high probability", or "score of 9/10". Measured quantities already in the evidence (byte deltas, TTL coverage, share of growth) may be repeated.
- Return JSON only, matching this shape:
{
  "headline": string,
  "summary": string,
  "likelyCause": null | {
    "pattern": string,
    "description": string,
    "citations": [{"evidenceId": string, "kind": "anomaly"|"attribution"|"ttl-drift"|"commit"|"gap", "statement": string}]
  },
  "hintedCandidateShas": string[],
  "supportingEvidence": [{"evidenceId": string, "kind": "anomaly"|"attribution"|"ttl-drift"|"commit"|"gap", "statement": string}],
  "recommendedActions": string[],
  "evidenceStrength": "strong"|"moderate"|"unclear",
  "unknowns": string[]
}`;

/**
 * Serialises an `EvidenceGraph` into a prompt.
 *
 * The prompt contains **only** what is in the evidence. It must not include general Redis lore,
 * "common causes of memory growth" framing, or any instruction that invites the model to fill a gap
 * from its priors — that framing is exactly how invented causes get in, and it reads as
 * authoritative when it does.
 *
 * The system message states that the model may only restate the supplied evidence, must cite an
 * evidence id for every claim, and must say the evidence is unclear rather than speculate. The
 * prompt asks for that behaviour; `validateExplanationAgainstEvidence` enforces it afterwards.
 */
export function buildExplanationPrompt(input: ReasonerInput): LlmCompletionRequest {
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: renderEvidenceBlock(input) },
    ],
    maxOutputTokens: 1024,
    temperature: 0,
    promptVersion: PROMPT_VERSION,
  };
}

function renderEvidenceBlock(input: ReasonerInput): string {
  const { graph } = input;
  const lines: string[] = [
    `graphId: ${graph.graphId}`,
    `window: ${graph.window.from} -> ${graph.window.to}`,
    `snapshotIds: ${graph.snapshotIds.join(', ') || '(none)'}`,
    '',
    'ANOMALIES',
  ];

  if (graph.anomalies.length === 0) {
    lines.push('(none)');
  }
  for (const anomaly of graph.anomalies) {
    lines.push(
      `- id=${anomaly.eventId} kind=${anomaly.kind} metric=${anomaly.metric} strength=${anomaly.evidenceStrength} deltaBytes=${String(anomaly.deltaBytes)} valueBefore=${String(anomaly.valueBefore)} valueAfter=${String(anomaly.valueAfter)} window=${anomaly.window.from}->${anomaly.window.to}`,
    );
    for (const observation of anomaly.observations) {
      lines.push(`  observation: ${observation}`);
    }
  }

  lines.push('', 'ATTRIBUTIONS');
  if (graph.attributions.length === 0) {
    lines.push('(none)');
  }
  for (const attribution of graph.attributions) {
    lines.push(
      `- id=${attribution.attributionId} pattern=${attribution.pattern} mechanism=${attribution.mechanism} strength=${attribution.evidenceStrength} bytesGrowth=${String(attribution.bytesGrowth)} keyCountGrowth=${String(attribution.keyCountGrowth)} shareOfAnomalyGrowth=${String(attribution.shareOfAnomalyGrowth)} anomalyId=${attribution.anomalyId}`,
    );
    for (const observation of attribution.observations) {
      lines.push(`  observation: ${observation}`);
    }
  }

  lines.push('', 'TTL DRIFT');
  if (graph.ttlDrift.length === 0) {
    lines.push('(none)');
  }
  for (const event of graph.ttlDrift) {
    lines.push(
      `- id=${event.eventId} pattern=${event.pattern} kind=${event.kind} strength=${event.evidenceStrength} ttlCoverageBefore=${String(event.ttlCoverageBefore)} ttlCoverageAfter=${String(event.ttlCoverageAfter)} medianTtlSecondsBefore=${String(event.medianTtlSecondsBefore)} medianTtlSecondsAfter=${String(event.medianTtlSecondsAfter)}`,
    );
    for (const observation of event.observations) {
      lines.push(`  observation: ${observation}`);
    }
  }

  lines.push('', 'GAPS');
  if (graph.gaps.length === 0) {
    lines.push('(none)');
  }
  for (const gap of graph.gaps) {
    lines.push(
      `- id=${gapEvidenceId(gap.kind)} kind=${gap.kind} detail=${gap.detail} remedy=${gap.remedy ?? '(none)'}`,
    );
  }

  lines.push('', 'COMMIT CANDIDATES');
  if (input.commitCandidates.length === 0) {
    lines.push('(none)');
  }
  for (const candidate of input.commitCandidates) {
    lines.push(
      `- sha=${candidate.sha} shortSha=${candidate.shortSha} committedAt=${candidate.committedAt} temporalRelation=${candidate.temporalRelation} matchedPatternHints=${candidate.matchedPatternHints.join(',') || '(none)'} message=${firstLine(candidate.message)}`,
    );
  }

  return lines.join('\n');
}

function firstLine(message: string): string {
  const line = message.split('\n')[0];
  return line === undefined || line.trim() === '' ? '(no message)' : line;
}
