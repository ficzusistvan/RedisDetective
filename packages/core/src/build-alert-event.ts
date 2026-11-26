import type { AlertAction } from './alert-action.js';
import type { AlertContext } from './alert-context.js';
import type { AlertEvent } from './alert-event.js';
import { alertFingerprint } from './alert-fingerprint.js';
import type { AlertFinding } from './alert-finding.js';
import type { AlertRule } from './alert-rule.js';
import { pagerdutyDedupKey } from './pagerduty-dedup-key.js';

export function buildAlertEvent(
  action: AlertAction,
  occurredAt: string,
  host: string,
  rule: AlertRule,
  finding: AlertFinding,
  context: AlertContext,
): AlertEvent {
  const identity = { host, pattern: finding.pattern, ruleId: rule.id, kind: finding.kind };
  return {
    action,
    occurredAt,
    fingerprint: alertFingerprint(identity),
    dedupKey: pagerdutyDedupKey(identity),
    rule,
    finding,
    context: {
      host,
      likelyCause: context.likelyCause,
      commitHints: context.commitHints,
    },
  };
}
