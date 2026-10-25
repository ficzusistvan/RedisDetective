export class AlertConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertConfigError';
  }
}

/**
 * `45s`, `15m`, `2h`, or a bare number of seconds. `0` is allowed (no cooldown).
 */
export function parseAlertDurationMs(raw: string, label = 'duration'): number {
  const match = /^(\d+)(s|m|h)?$/.exec(raw.trim());
  const digits = match?.[1];
  if (digits === undefined) {
    throw new AlertConfigError(
      `${label} expects a duration such as 45s, 15m or 2h, or a plain number of seconds, received "${raw}".`,
    );
  }
  const amount = Number(digits);
  const unit = match?.[2] ?? 's';
  const multiplier = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1_000;
  return amount * multiplier;
}
