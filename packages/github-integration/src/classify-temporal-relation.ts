import type { TimeWindow } from '@redis-detective/core-types';
import type { TemporalRelation } from '@redis-detective/core-types';

/**
 * Places a commit relative to the anomaly window.
 *
 * `'after-anomaly'` is a real classification, not a drop: a commit that landed after growth began
 * is too late to fall in the growth window, and the report has to be able to say so rather than
 * silently omitting it.
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
  if (at < from) {
    return 'before-anomaly';
  }
  if (at > to) {
    return 'after-anomaly';
  }
  return 'within-anomaly-window';
}
