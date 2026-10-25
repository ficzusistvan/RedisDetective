import { describe, expect, it } from 'vitest';

import { emptyAlertConfigLayers, mergeAlertConfig } from '@redis-detective/alerts';

describe('mergeAlertConfig', () => {
  it('adds a cli rule from --fail-on flags next to file rules', () => {
    const config = mergeAlertConfig({
      ...emptyAlertConfigLayers(),
      file: {
        cooldownMs: 10_000,
        severity: 'warning',
        pagerdutyMinSeverity: null,
        slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x',
        webhookUrl: null,
        webhookSecret: null,
        pagerdutyRoutingKey: null,
        pagerdutyEventsUrl: null,
        rules: [
          {
            id: 'file-ttl',
            severity: 'critical',
            channels: ['slack'],
            thresholds: {
              growthPercent: null,
              growthBytes: null,
              ttlDropPoints: 20,
              newUntimedPatterns: false,
            },
          },
        ],
      },
      cliHasThresholds: true,
      cliThresholds: {
        growthPercent: 25,
        growthBytes: null,
        ttlDropPoints: null,
        newUntimedPatterns: false,
      },
      slackWebhookUrl: 'https://hooks.slack.com/services/override',
      severity: 'critical',
      dryRun: true,
      stateFile: './snaps/.redis-detective-alerts.json',
    });

    expect(config.cooldownMs).toBe(10_000);
    expect(config.dryRun).toBe(true);
    expect(config.channels.slackWebhookUrl).toBe('https://hooks.slack.com/services/override');
    expect(config.rules.map((rule) => rule.id)).toEqual(['file-ttl', 'cli']);
    expect(config.rules[1]?.severity).toBe('critical');
  });
});
