import type { AlertSeverity } from './alert-severity.js';

/** Shared with notifiers that build webhook/PagerDuty bodies. */
export const ALERT_PAYLOAD_SCHEMA_VERSION = 1;

export const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60 * 1_000;

export const DEFAULT_ALERT_SEVERITY: AlertSeverity = 'warning';

export const ALERT_STATE_SCHEMA_VERSION = 1;

/** Implicit rule id when CLI thresholds are passed without a named rules file. */
export const IMPLICIT_CLI_RULE_ID = 'cli';
