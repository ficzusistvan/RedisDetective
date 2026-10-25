export const ALERT_CHANNELS = ['slack', 'webhook', 'pagerduty'] as const;

export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export function isAlertChannel(value: string): value is AlertChannel {
  return (ALERT_CHANNELS as readonly string[]).includes(value);
}
