import { describe, expect, it } from 'vitest';

import { parseAlertConfigFile } from '@redis-detective/alerts';

const JSON_CONFIG = `{
  "alerts": {
    "cooldown": "30m",
    "pagerdutyMinSeverity": "warning",
    "channels": {
      "slack": { "webhook": "\${REDIS_DETECTIVE_SLACK_WEBHOOK}" },
      "webhook": { "url": "https://example.com/hook", "secret": "s3cret" }
    },
    "rules": [
      {
        "id": "ttl-drop",
        "severity": "critical",
        "channels": ["slack", "pagerduty"],
        "ttlDropPoints": 20
      }
    ]
  }
}`;

const YAML_CONFIG = `
alerts:
  cooldown: 1h
  channels:
    slack:
      webhook: https://hooks.slack.com/services/T000/B000/xxx
  rules:
    - id: growth
      severity: warning
      channels: [slack, webhook]
      growthPercent: 25
      growthBytes: 10485760
`;

describe('parseAlertConfigFile', () => {
  it('reads JSON rules and expands env placeholders', () => {
    const parsed = parseAlertConfigFile(JSON_CONFIG, '.redis-detective.json', {
      REDIS_DETECTIVE_SLACK_WEBHOOK: 'https://hooks.slack.com/services/T1/B1/abc',
    });

    expect(parsed.cooldownMs).toBe(30 * 60 * 1_000);
    expect(parsed.pagerdutyMinSeverity).toBe('warning');
    expect(parsed.slackWebhookUrl).toBe('https://hooks.slack.com/services/T1/B1/abc');
    expect(parsed.webhookUrl).toBe('https://example.com/hook');
    expect(parsed.rules).toEqual([
      {
        id: 'ttl-drop',
        severity: 'critical',
        channels: ['slack', 'pagerduty'],
        thresholds: {
          growthPercent: null,
          growthBytes: null,
          ttlDropPoints: 20,
          newUntimedPatterns: false,
        },
      },
    ]);
  });

  it('reads a YAML rule file', () => {
    const parsed = parseAlertConfigFile(YAML_CONFIG, '.redis-detective.yaml', {});

    expect(parsed.cooldownMs).toBe(60 * 60 * 1_000);
    expect(parsed.slackWebhookUrl).toBe('https://hooks.slack.com/services/T000/B000/xxx');
    expect(parsed.rules[0]).toMatchObject({
      id: 'growth',
      severity: 'warning',
      channels: ['slack', 'webhook'],
      thresholds: { growthPercent: 25, growthBytes: 10_485_760 },
    });
  });
});
