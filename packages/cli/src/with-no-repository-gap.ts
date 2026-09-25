import type { EvidenceGap, EvidenceGraph } from '@redis-detective/core-types';

const NO_REPOSITORY_GAP: EvidenceGap = {
  kind: 'no-repository-connected',
  detail:
    'No GitHub repository was connected, so no commit can be named as a candidate for the growth.',
  remedy:
    'When you have a named Redis Cause, re-run against the same --snapshots directory with --repo owner/repo after installing a GitHub App on the repository that writes that key pattern (contents:read and pull_requests:read). Pick the service repo that owns the pattern, not the repo that merely hosts Redis.',
};

/**
 * Records that commit-candidate lookup was skipped because no repository was given.
 *
 * `buildEvidenceGraph` never emits this gap: it is given snapshots and nothing else. Whoever
 * assembles commit candidates — here, the CLI — is the one that knows whether a repo was connected.
 * Callers should only invoke this when `shouldNudgeRepositoryConnection` is true. The graph is
 * copied, not mutated.
 */
export function withNoRepositoryGap(graph: EvidenceGraph): EvidenceGraph {
  if (graph.gaps.some((gap) => gap.kind === 'no-repository-connected')) {
    return graph;
  }

  return {
    graphId: graph.graphId,
    builtAt: graph.builtAt,
    window: graph.window,
    snapshotIds: graph.snapshotIds,
    anomalies: graph.anomalies,
    attributions: graph.attributions,
    ttlDrift: graph.ttlDrift,
    gaps: [...graph.gaps, NO_REPOSITORY_GAP].sort(
      (left, right) => left.kind.localeCompare(right.kind) || left.detail.localeCompare(right.detail),
    ),
  };
}
