export const ALERT_ACTIONS = ['firing', 'resolved'] as const;

export type AlertAction = (typeof ALERT_ACTIONS)[number];
