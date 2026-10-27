const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatAlertBytes(bytes: number): string {
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  let unitIndex = 0;

  while (value >= 1_024 && unitIndex < UNITS.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }

  const unit = UNITS[unitIndex] ?? 'B';
  const rendered = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${sign}~${rendered} ${unit} est.`;
}

export function formatAlertPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function formatAlertPoints(points: number): string {
  return `${points.toFixed(1)} points`;
}
