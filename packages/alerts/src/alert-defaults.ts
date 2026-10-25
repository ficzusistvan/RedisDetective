import type { AlertSeverity } from './alert-severity.js';

export const ALERT_PAYLOAD_SCHEMA_VERSION = 1;

export const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60 * 1_000;

export const DEFAULT_ALERT_SEVERITY: AlertSeverity = 'warning';

/** PagerDuty receives a rule only when its severity is at least this. */
export const DEFAULT_PAGERDUTY_MIN_SEVERITY: AlertSeverity = 'critical';

export const DEFAULT_ALERT_HTTP_TIMEOUT_MS = 10_000;

export const DEFAULT_ALERT_HTTP_RETRIES = 3;

export const DEFAULT_ALERT_HTTP_BACKOFF_MS = 250;

export const DEFAULT_PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export const ALERT_STATE_SCHEMA_VERSION = 1;

export const DEFAULT_ALERT_STATE_FILE_NAME = '.redis-detective-alerts.json';

export const WEBHOOK_SIGNATURE_HEADER = 'x-redis-detective-signature';

export const WEBHOOK_EVENT_HEADER = 'x-redis-detective-event';

export const ALERT_CONFIG_FILE_NAMES = [
  '.redis-detective.json',
  '.redis-detective.yaml',
  '.redis-detective.yml',
] as const;

export const ALERT_ENV_VARS = {
  slackWebhook: 'REDIS_DETECTIVE_SLACK_WEBHOOK',
  webhookUrl: 'REDIS_DETECTIVE_WEBHOOK_URL',
  webhookSecret: 'REDIS_DETECTIVE_WEBHOOK_SECRET',
  pagerdutyRoutingKey: 'REDIS_DETECTIVE_PAGERDUTY_ROUTING_KEY',
  pagerdutyEventsUrl: 'REDIS_DETECTIVE_PAGERDUTY_EVENTS_URL',
  cooldown: 'REDIS_DETECTIVE_ALERT_COOLDOWN',
  config: 'REDIS_DETECTIVE_ALERT_CONFIG',
  severity: 'REDIS_DETECTIVE_ALERT_SEVERITY',
  pagerdutyMinSeverity: 'REDIS_DETECTIVE_PAGERDUTY_MIN_SEVERITY',
} as const;

export const IMPLICIT_CLI_RULE_ID = 'cli';
