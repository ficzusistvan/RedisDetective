import type { TimeWindow } from '@redis-detective/core-types';
import type { TemporalRelation } from '@redis-detective/core-types';

/**
 * Places a commit relative to the anomaly window.
 *
 * Returns `null` when the timestamp is unparseable or the commit landed after `window.to`.
 * Post-window commits are not Commit candidates; they are dropped rather than labelled.
 */
export function classifyTemporalRelation(
  committedAt: string,
  window: TimeWindow,
): TemporalRelation | null {
  const at = Date.parse(committedAt);
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (!Number.isFinite(at) || !Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  if (at > to) {
    return null;
  }
  if (at < from) {
    return 'before-anomaly';
  }
  return 'within-anomaly-window';
}
