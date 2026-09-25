export type EvidenceIdKind = 'anomaly' | 'attribution' | 'ttl-drift' | 'graph';

/**
 * FNV-1a. Chosen because it is tiny, dependency-free and — the only property that matters here —
 * completely deterministic. This is an identity function for evidence nodes, never a security or
 * uniqueness-critical hash.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds a stable identifier for an evidence node from the facts that define it.
 *
 * Deterministic on purpose: `packages/evidence` may not use `crypto.randomUUID()` or the clock, so
 * re-running the analysis over the same snapshots yields byte-identical output. That is what makes
 * an `Explanation`'s citations reproducible and a regression test possible — a random id would
 * silently break both.
 */
export function createEvidenceId(kind: EvidenceIdKind, parts: readonly string[]): string {
  const label = parts.length > 0 ? slugify(parts.join('-')) : 'unknown';
  const digest = fnv1a([kind, ...parts].join('\u0000'));
  const truncatedLabel = label.slice(0, 48);
  return `${kind}-${truncatedLabel}-${digest}`;
}
