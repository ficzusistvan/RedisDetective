import type { EvidenceGraph, GitCommitCandidate } from '@redis-detective/core-types';

/**
 * Everything the reasoner is allowed to know.
 *
 * This type is the enforcement point for "the reasoner never fetches its own data": if a fact is
 * not reachable from here, it may not appear in the output. Do not add a client, a fetcher, a
 * repository handle or a callback to this interface — additions must be plain data computed
 * elsewhere.
 */
export interface ReasonerInput {
  readonly graph: EvidenceGraph;
  /** Supplied by the caller from `packages/github-integration`; empty when no repo is connected. */
  readonly commitCandidates: readonly GitCommitCandidate[];
  /** ISO-8601 UTC for `Explanation.generatedAt`, passed in so output stays reproducible. */
  readonly generatedAt: string;
}

/** Stable id for a gap so an explanation can cite it. Gaps have a kind, not their own event id. */
export function gapEvidenceId(kind: string): string {
  return `gap:${kind}`;
}

/** Every evidence id the reasoner may legitimately cite, in one flat set. */
export function collectCitableEvidenceIds(input: ReasonerInput): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const anomaly of input.graph.anomalies) {
    ids.add(anomaly.eventId);
  }
  for (const attribution of input.graph.attributions) {
    ids.add(attribution.attributionId);
  }
  for (const drift of input.graph.ttlDrift) {
    ids.add(drift.eventId);
  }
  for (const candidate of input.commitCandidates) {
    ids.add(candidate.sha);
  }
  for (const gap of input.graph.gaps) {
    ids.add(gapEvidenceId(gap.kind));
  }

  return ids;
}
