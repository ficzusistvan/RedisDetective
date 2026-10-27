import type { AlertChannel } from './alert-channel.js';
import type { AlertRule } from './alert-rule.js';
import type { AlertSeverity } from './alert-severity.js';

export interface AlertChannelConfig {
  readonly slackWebhookUrl: string | null;
  readonly webhookUrl: string | null;
  readonly webhookSecret: string | null;
  readonly pagerdutyRoutingKey: string | null;
  readonly pagerdutyEventsUrl: string | null;
}

export interface ResolvedAlertConfig {
  readonly cooldownMs: number;
  readonly dryRun: boolean;
  readonly severity: AlertSeverity;
  readonly pagerdutyMinSeverity: AlertSeverity;
  readonly stateFile: string | null;
  readonly channels: AlertChannelConfig;
  readonly rules: readonly AlertRule[];
}

export function configuredChannels(config: AlertChannelConfig): readonly AlertChannel[] {
  const channels: AlertChannel[] = [];
  if (config.slackWebhookUrl !== null && config.slackWebhookUrl !== '') {
    channels.push('slack');
  }
  if (config.webhookUrl !== null && config.webhookUrl !== '') {
    channels.push('webhook');
  }
  if (config.pagerdutyRoutingKey !== null && config.pagerdutyRoutingKey !== '') {
    channels.push('pagerduty');
  }
  return channels;
}

export function hasAlertChannels(config: AlertChannelConfig): boolean {
  return configuredChannels(config).length > 0;
}

export function emptyAlertChannelConfig(): AlertChannelConfig {
  return {
    slackWebhookUrl: null,
    webhookUrl: null,
    webhookSecret: null,
    pagerdutyRoutingKey: null,
    pagerdutyEventsUrl: null,
  };
}
