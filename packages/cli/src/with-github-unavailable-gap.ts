import type { EvidenceGap, EvidenceGraph } from '@redis-detective/core-types';

/**
 * Records that commit-candidate lookup was requested but could not complete.
 *
 * The Redis evidence is unaffected: this gap explains empty candidates when the operator passed
 * `--repo` (or an equivalent) and GitHub auth or the API failed. The graph is copied, not mutated.
 */
export function withGitHubUnavailableGap(
  graph: EvidenceGraph,
  detail: string,
): EvidenceGraph {
  if (graph.gaps.some((gap) => gap.kind === 'github-unavailable')) {
    return graph;
  }

  const gap: EvidenceGap = {
    kind: 'github-unavailable',
    detail,
    remedy:
      'Check the GitHub App is installed on that repository with contents:read and pull_requests:read, and that GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and a private key are set (see README). Then re-run with the same --snapshots directory and --repo.',
  };

  return {
    graphId: graph.graphId,
    builtAt: graph.builtAt,
    window: graph.window,
    snapshotIds: graph.snapshotIds,
    anomalies: graph.anomalies,
    attributions: graph.attributions,
    ttlDrift: graph.ttlDrift,
    gaps: [...graph.gaps, gap].sort(
      (left, right) => left.kind.localeCompare(right.kind) || left.detail.localeCompare(right.detail),
    ),
  };
}
