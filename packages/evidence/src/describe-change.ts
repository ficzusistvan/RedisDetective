import { relativeChange } from './relative-change.js';

/** Unit of the quantity being described, so the observation names what it counted. */
export type ChangeUnit = 'bytes' | 'keys' | 'seconds' | 'ratio';

function formatRelative(before: number, after: number): string {
  const change = relativeChange(before, after);
  if (!Number.isFinite(change)) {
    return before === after ? 'no change' : 'from zero';
  }
  const sign = change >= 0 ? '+' : '';
  return `${sign}${(change * 100).toFixed(1)}%`;
}

/**
 * Renders one measured change as a sentence, for an `observations` list.
 *
 * Observations are the citable record behind a claim: `packages/reasoner` may only say things it can
 * trace to one of these, so each has to be self-contained and checkable against the user's own
 * `INFO` output.
 *
 * Quantities stay in their raw units — bytes as bytes, not megabytes. Human-readable formatting
 * belongs to whatever renders the report, and doing it here would mean two packages formatting
 * bytes differently and a reader unable to tell whether `64 MB` was `1000` or `1024` based.
 */
export function describeChange(
  label: string,
  before: number,
  after: number,
  unit: ChangeUnit,
): string {
  const suffix = unit === 'ratio' ? '' : ` ${unit}`;
  const rendered =
    unit === 'ratio' ? [before.toFixed(2), after.toFixed(2)] : [String(before), String(after)];

  return `${label} moved from ${rendered[0]}${suffix} to ${rendered[1]}${suffix} (${formatRelative(before, after)}).`;
}
