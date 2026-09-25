import type { EvidenceGraph } from '@redis-detective/core-types';

/**
 * Whether the Redis-only report should nudge the operator to connect a GitHub repo.
 *
 * Only when there is a pattern attribution with strong or moderate evidence — otherwise commit
 * candidates have nothing useful to correlate with, and the gap would sell a second pass that
 * cannot help.
 */
export function shouldNudgeRepositoryConnection(graph: EvidenceGraph): boolean {
  return graph.attributions.some(
    (attribution) =>
      attribution.evidenceStrength === 'strong' || attribution.evidenceStrength === 'moderate',
  );
}
