import type { AlertEvent } from './alert-event.js';
import { buildAlertPayload } from './build-alert-payload.js';
import { describeAlertFinding, describeAlertFindingKind } from './describe-alert-finding.js';
import type { PagerDutyEnqueueBody } from './pagerduty-event.js';
import { pagerdutyEventAction, pagerdutySeverity } from './pagerduty-event.js';

export function buildPagerdutyEvent(event: AlertEvent, routingKey: string): PagerDutyEnqueueBody {
  const kind = describeAlertFindingKind(event.finding);
  const payload = buildAlertPayload(event);

  return {
    routing_key: routingKey,
    event_action: pagerdutyEventAction(event.action),
    dedup_key: event.dedupKey,
    payload: {
      summary: `${event.finding.pattern}: ${kind} (${event.action})`,
      source: event.context.host,
      severity: pagerdutySeverity(event.rule.severity),
      timestamp: event.occurredAt,
      custom_details: {
        pattern: payload.pattern,
        change: payload.change,
        detail: describeAlertFinding(event.finding),
        ruleId: payload.rule.id,
        likelyCause: payload.likelyCause,
        commitHints: payload.commitHints,
        host: payload.host,
      },
    },
  };
}
