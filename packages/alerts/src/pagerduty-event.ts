import type { AlertAction } from './alert-action.js';
import type { AlertSeverity } from './alert-severity.js';

export type PagerDutyEventAction = 'trigger' | 'resolve';

export type PagerDutySeverity = 'critical' | 'error' | 'warning' | 'info';

/**
 * Events API v2 enqueue body. `routing_key` is supplied by the notifier at send time
 * and is never copied into the generic webhook payload or logs.
 */
export interface PagerDutyEnqueueBody {
  readonly routing_key: string;
  readonly event_action: PagerDutyEventAction;
  readonly dedup_key: string;
  readonly payload: {
    readonly summary: string;
    readonly source: string;
    readonly severity: PagerDutySeverity;
    readonly timestamp: string;
    readonly custom_details: Readonly<Record<string, unknown>>;
  };
}

export function pagerdutyEventAction(action: AlertAction): PagerDutyEventAction {
  return action === 'resolved' ? 'resolve' : 'trigger';
}

export function pagerdutySeverity(severity: AlertSeverity): PagerDutySeverity {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
  }
}
