const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Formats a byte count for a terminal report, using binary units.
 *
 * Kept in one place so that no code path can print a raw byte count in one column and a formatted
 * one in another, which makes a report look inconsistent about its own precision.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) {
    return 'unknown';
  }

  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  let unitIndex = 0;

  while (value >= 1_024 && unitIndex < UNITS.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }

  const unit = UNITS[unitIndex] ?? 'B';
  // Whole bytes read oddly with a decimal; larger units need one to stay useful.
  const rendered = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${sign}${rendered} ${unit}`;
}

/**
 * Marks an extrapolated figure as an estimate.
 *
 * Every per-pattern number comes from a bounded sample, and the report must never let one be
 * quoted as measured. See the sampling rationale in the root AGENTS.md.
 */
export function formatEstimatedBytes(bytes: number, isEstimate: boolean): string {
  return isEstimate ? `~${formatBytes(bytes)} est.` : formatBytes(bytes);
}

export function formatCount(count: number, isEstimate: boolean): string {
  const rendered = count.toLocaleString('en-US');
  return isEstimate ? `~${rendered}` : rendered;
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Renders a TTL in the largest unit that keeps it readable.
 *
 * Each unit is chosen after rounding, so a TTL of 3599s reads as `1.0h` rather than `60m` beside a
 * neighbouring `2.0h` in the same column.
 */
export function formatDuration(seconds: number): string {
  if (Math.round(seconds) < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (Math.round(seconds / 60) < 60) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (Math.round(seconds / 3_600) < 24) {
    return `${(seconds / 3_600).toFixed(1)}h`;
  }
  return `${(seconds / 86_400).toFixed(1)}d`;
}
