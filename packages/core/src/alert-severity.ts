export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

const RANK: Readonly<Record<AlertSeverity, number>> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function isAlertSeverity(value: string): value is AlertSeverity {
  return (ALERT_SEVERITIES as readonly string[]).includes(value);
}

/**
 * True when `severity` is at least `minimum` (critical > warning > info).
 *
 * Used to decide whether PagerDuty should receive an event. Slack and the generic webhook
 * fire for every configured rule; paging is opt-in by severity.
 */
export function severityMeetsMinimum(severity: AlertSeverity, minimum: AlertSeverity): boolean {
  return RANK[severity] >= RANK[minimum];
}
