import type { AlertAction } from './alert-action.js';
import type { AlertContext } from './alert-context.js';
import type { AlertFinding } from './alert-finding.js';
import type { AlertRule } from './alert-rule.js';

/**
 * One notification the state machine decided to send (or reprint in dry-run).
 *
 * Built only from a gate finding plus the redacted host and any cause/commit hints the
 * diagnosis already had. No snapshot, no example keys, no credentials.
 */
export interface AlertEvent {
  readonly action: AlertAction;
  readonly occurredAt: string;
  readonly fingerprint: string;
  readonly dedupKey: string;
  readonly rule: AlertRule;
  readonly finding: AlertFinding;
  readonly context: AlertContext;
}
