import type { EvidenceGraph } from '@redis-detective/core-types';

/**
 * Turns evidence patterns (`session:*`) into the prefixes GitHub lookup searches for (`session:`).
 *
 * Trailing glob stars are sampling notation, not characters that appear in source. The colon stays:
 * that is the Redis key-prefix convention the matcher looks for in messages and paths.
 */
export function patternHintsFromGraph(graph: EvidenceGraph): readonly string[] {
  const hints: string[] = [];
  const seen = new Set<string>();

  for (const pattern of [
    ...graph.attributions.map((attribution) => attribution.pattern),
    ...graph.ttlDrift.map((event) => event.pattern),
  ]) {
    const hint = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    if (hint === '' || seen.has(hint)) {
      continue;
    }
    seen.add(hint);
    hints.push(hint);
  }

  return hints;
}
