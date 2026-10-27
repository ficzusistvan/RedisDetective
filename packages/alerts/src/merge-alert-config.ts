import { emptyAlertChannelConfig } from './alert-config.js';
import type { ResolvedAlertConfig } from './alert-config.js';
import {
  DEFAULT_ALERT_COOLDOWN_MS,
  DEFAULT_ALERT_SEVERITY,
  DEFAULT_PAGERDUTY_MIN_SEVERITY,
  IMPLICIT_CLI_RULE_ID,
} from './alert-defaults.js';
import type { AlertRuleThresholds } from './alert-rule.js';
import type { ParsedAlertConfigFile } from './parse-alert-config-file.js';
import type { AlertSeverity } from './alert-severity.js';

export interface AlertConfigLayers {
  readonly file: ParsedAlertConfigFile | null;
  readonly cliThresholds: AlertRuleThresholds;
  readonly cliHasThresholds: boolean;
  readonly slackWebhookUrl: string | null;
  readonly webhookUrl: string | null;
  readonly webhookSecret: string | null;
  readonly pagerdutyRoutingKey: string | null;
  readonly pagerdutyEventsUrl: string | null;
  readonly cooldownMs: number | null;
  readonly severity: AlertSeverity | null;
  readonly pagerdutyMinSeverity: AlertSeverity | null;
  readonly dryRun: boolean;
  readonly stateFile: string | null;
}

/**
 * Merge order: defaults < config file < env/flags (already resolved by the CLI).
 *
 * CLI `--fail-on-*` become rule `cli` and are evaluated alongside any file rules, so a
 * one-off threshold does not erase a documented rule set.
 */
export function mergeAlertConfig(layers: AlertConfigLayers): ResolvedAlertConfig {
  const file = layers.file;
  const severity = layers.severity ?? file?.severity ?? DEFAULT_ALERT_SEVERITY;
  const rules = [...(file?.rules ?? [])];
  if (layers.cliHasThresholds) {
    rules.push({
      id: IMPLICIT_CLI_RULE_ID,
      severity,
      channels: [],
      thresholds: layers.cliThresholds,
    });
  }

  return {
    cooldownMs: layers.cooldownMs ?? file?.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS,
    dryRun: layers.dryRun,
    severity,
    pagerdutyMinSeverity:
      layers.pagerdutyMinSeverity ?? file?.pagerdutyMinSeverity ?? DEFAULT_PAGERDUTY_MIN_SEVERITY,
    stateFile: layers.stateFile,
    channels: {
      slackWebhookUrl: firstString(layers.slackWebhookUrl, file?.slackWebhookUrl ?? null),
      webhookUrl: firstString(layers.webhookUrl, file?.webhookUrl ?? null),
      webhookSecret: firstString(layers.webhookSecret, file?.webhookSecret ?? null),
      pagerdutyRoutingKey: firstString(
        layers.pagerdutyRoutingKey,
        file?.pagerdutyRoutingKey ?? null,
      ),
      pagerdutyEventsUrl: firstString(layers.pagerdutyEventsUrl, file?.pagerdutyEventsUrl ?? null),
    },
    rules,
  };
}

export function emptyAlertConfigLayers(): AlertConfigLayers {
  return {
    file: null,
    cliThresholds: {
      growthPercent: null,
      growthBytes: null,
      ttlDropPoints: null,
      newUntimedPatterns: false,
    },
    cliHasThresholds: false,
    slackWebhookUrl: null,
    webhookUrl: null,
    webhookSecret: null,
    pagerdutyRoutingKey: null,
    pagerdutyEventsUrl: null,
    cooldownMs: null,
    severity: null,
    pagerdutyMinSeverity: null,
    dryRun: false,
    stateFile: null,
  };
}

export function emptyResolvedAlertConfig(): ResolvedAlertConfig {
  return {
    cooldownMs: DEFAULT_ALERT_COOLDOWN_MS,
    dryRun: false,
    severity: DEFAULT_ALERT_SEVERITY,
    pagerdutyMinSeverity: DEFAULT_PAGERDUTY_MIN_SEVERITY,
    stateFile: null,
    channels: emptyAlertChannelConfig(),
    rules: [],
  };
}

function firstString(preferred: string | null, fallback: string | null): string | null {
  return preferred !== null && preferred !== '' ? preferred : fallback;
}
