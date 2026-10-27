import { isAlertChannel } from './alert-channel.js';
import type { AlertChannel } from './alert-channel.js';
import type { AlertRule, AlertRuleThresholds } from './alert-rule.js';
import { DEFAULT_ALERT_SEVERITY } from './alert-defaults.js';
import { expandEnvPlaceholders } from './expand-env-placeholders.js';
import { AlertConfigError, parseAlertDurationMs } from './parse-duration-ms.js';
import { parseSimpleYaml } from './parse-simple-yaml.js';
import { isAlertSeverity } from './alert-severity.js';
import type { AlertSeverity } from './alert-severity.js';

export interface ParsedAlertConfigFile {
  readonly cooldownMs: number | null;
  readonly severity: AlertSeverity | null;
  readonly pagerdutyMinSeverity: AlertSeverity | null;
  readonly slackWebhookUrl: string | null;
  readonly webhookUrl: string | null;
  readonly webhookSecret: string | null;
  readonly pagerdutyRoutingKey: string | null;
  readonly pagerdutyEventsUrl: string | null;
  readonly rules: readonly AlertRule[];
}

export function parseAlertConfigFile(
  raw: string,
  filePath: string,
  env: Readonly<Record<string, string | undefined>> = {},
): ParsedAlertConfigFile {
  const document = parseDocument(raw, filePath);
  if (!isRecord(document)) {
    throw new AlertConfigError(`${filePath}: config root must be an object.`);
  }

  const alerts = isRecord(document['alerts']) ? document['alerts'] : document;
  const channels = isRecord(alerts['channels']) ? alerts['channels'] : {};
  const slack = isRecord(channels['slack']) ? channels['slack'] : {};
  const webhook = isRecord(channels['webhook']) ? channels['webhook'] : {};
  const pagerduty = isRecord(channels['pagerduty']) ? channels['pagerduty'] : {};

  return {
    cooldownMs: optionalDuration(alerts['cooldown'], `${filePath} alerts.cooldown`),
    severity: optionalSeverity(alerts['severity'], `${filePath} alerts.severity`),
    pagerdutyMinSeverity: optionalSeverity(
      firstDefined(alerts['pagerdutyMinSeverity'], pagerduty['minSeverity']),
      `${filePath} alerts.pagerdutyMinSeverity`,
    ),
    slackWebhookUrl: optionalString(firstDefined(alerts['slackWebhook'], slack['webhook']), env),
    webhookUrl: optionalString(firstDefined(alerts['webhookUrl'], webhook['url']), env),
    webhookSecret: optionalString(firstDefined(alerts['webhookSecret'], webhook['secret']), env),
    pagerdutyRoutingKey: optionalString(
      firstDefined(alerts['pagerdutyRoutingKey'], pagerduty['routingKey']),
      env,
    ),
    pagerdutyEventsUrl: optionalString(
      firstDefined(alerts['pagerdutyEventsUrl'], pagerduty['eventsUrl']),
      env,
    ),
    rules: parseRules(alerts['rules'], filePath),
  };
}

function parseDocument(raw: string, filePath: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return {};
  }
  const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml');
  if (!isYaml) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new AlertConfigError(`${filePath}: not valid JSON.`);
    }
  }
  return parseSimpleYaml(raw);
}

function parseRules(value: unknown, filePath: string): readonly AlertRule[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AlertConfigError(`${filePath}: alerts.rules must be an array.`);
  }
  return value.map((entry, index) =>
    parseRule(entry, `${filePath} alerts.rules[${String(index)}]`),
  );
}

function parseRule(value: unknown, label: string): AlertRule {
  if (!isRecord(value)) {
    throw new AlertConfigError(`${label} must be an object.`);
  }
  const id = value['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    throw new AlertConfigError(`${label} needs a non-empty id.`);
  }
  const severityRaw = value['severity'];
  const severity =
    severityRaw === undefined || severityRaw === null
      ? DEFAULT_ALERT_SEVERITY
      : readSeverity(severityRaw, `${label}.severity`);

  return {
    id: id.trim(),
    severity,
    channels: parseChannelList(value['channels'], `${label}.channels`),
    thresholds: parseThresholds(value, label),
  };
}

function parseThresholds(value: Record<string, unknown>, label: string): AlertRuleThresholds {
  const nested = isRecord(value['thresholds']) ? value['thresholds'] : value;
  return {
    growthPercent: optionalNumber(nested['growthPercent'], `${label}.growthPercent`),
    growthBytes: optionalNumber(nested['growthBytes'], `${label}.growthBytes`),
    ttlDropPoints: optionalNumber(
      firstDefined(nested['ttlDropPoints'], nested['ttlDrop']),
      `${label}.ttlDropPoints`,
    ),
    newUntimedPatterns: optionalBoolean(nested['newUntimedPatterns']) ?? false,
  };
}

function parseChannelList(value: unknown, label: string): readonly AlertChannel[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AlertConfigError(`${label} must be an array of channel names.`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !isAlertChannel(entry)) {
      throw new AlertConfigError(`${label}: unknown channel "${String(entry)}".`);
    }
    return entry;
  });
}

function optionalString(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const expanded = expandEnvPlaceholders(value, env).trim();
  return expanded === '' ? null : expanded;
}

function optionalNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AlertConfigError(`${label} expects a non-negative number.`);
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function optionalDuration(value: unknown, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    return parseAlertDurationMs(value, label);
  }
  throw new AlertConfigError(`${label} expects a duration such as 1h.`);
}

function optionalSeverity(value: unknown, label: string): AlertSeverity | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readSeverity(value, label);
}

function readSeverity(value: unknown, label: string): AlertSeverity {
  if (typeof value !== 'string' || !isAlertSeverity(value)) {
    throw new AlertConfigError(`${label} expects info, warning, or critical.`);
  }
  return value;
}

function firstDefined(...values: readonly unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
