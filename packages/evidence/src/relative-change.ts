/**
 * Fractional change from `before` to `after`, e.g. `0.25` for a 25% rise.
 *
 * Growth from zero is `Infinity` rather than `0`. That is deliberate: returning zero would make
 * "an empty instance started filling up" compare as *no change* against any threshold, silently
 * suppressing the most obvious growth there is. `Infinity` clears every threshold, which is the
 * honest answer — the rise is real and unbounded in relative terms.
 */
export function relativeChange(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return 0;
  }
  if (before === after) {
    return 0;
  }
  if (before <= 0) {
    return after > before ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return (after - before) / before;
}
