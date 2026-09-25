import type {
  Explanation,
  ExplanationCitation,
  ExplanationCause,
  LlmAttribution,
} from '@redis-detective/core-types';
import { isEvidenceStrength } from '@redis-detective/core-types';

import { isEvidenceKind } from './validate-explanation-against-evidence.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return null;
    }
    items.push(entry);
  }
  return items;
}

function readCitation(value: unknown): ExplanationCitation | null {
  if (!isRecord(value)) {
    return null;
  }
  const evidenceId = readString(value['evidenceId']);
  const kind = value['kind'];
  const statement = readString(value['statement']);
  if (evidenceId === null || statement === null || !isEvidenceKind(kind)) {
    return null;
  }
  return { evidenceId, kind, statement };
}

function readCitations(value: unknown): readonly ExplanationCitation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const citations: ExplanationCitation[] = [];
  for (const entry of value) {
    const citation = readCitation(entry);
    if (citation === null) {
      return null;
    }
    citations.push(citation);
  }
  return citations;
}

function readCause(value: unknown): ExplanationCause | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const pattern = readString(value['pattern']);
  const description = readString(value['description']);
  const citations = readCitations(value['citations']);
  if (pattern === null || description === null || citations === null) {
    return undefined;
  }
  return { pattern, description, citations };
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) {
    return null;
  }
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export interface ParseLlmExplanationContext {
  readonly graphId: string;
  readonly generatedAt: string;
  readonly model: LlmAttribution;
}

/**
 * Parses model output into an `Explanation`. Malformed JSON or a missing field returns `null`
 * so the caller can fall back to the deterministic baseline rather than repairing a guess.
 */
export function parseLlmExplanation(
  text: string,
  context: ParseLlmExplanationContext,
): Explanation | null {
  const parsed = extractJsonObject(text);
  if (!isRecord(parsed)) {
    return null;
  }

  const headline = readString(parsed['headline']);
  const summary = readString(parsed['summary']);
  const recommendedActions = readStringArray(parsed['recommendedActions']);
  const unknowns = readStringArray(parsed['unknowns']);
  const supportingEvidence = readCitations(parsed['supportingEvidence']);
  const evidenceStrength = parsed['evidenceStrength'];
  const likelyCause = readCause(parsed['likelyCause']);
  const hintedCandidateShas = readStringArray(parsed['hintedCandidateShas']);

  if (
    headline === null ||
    summary === null ||
    recommendedActions === null ||
    unknowns === null ||
    supportingEvidence === null ||
    !isEvidenceStrength(evidenceStrength) ||
    likelyCause === undefined ||
    hintedCandidateShas === null
  ) {
    return null;
  }

  return {
    explanationId: `explanation-${context.graphId}`,
    generatedAt: context.generatedAt,
    graphId: context.graphId,
    headline,
    summary,
    likelyCause,
    hintedCandidateShas,
    supportingEvidence,
    recommendedActions,
    evidenceStrength,
    unknowns,
    model: context.model,
  };
}
