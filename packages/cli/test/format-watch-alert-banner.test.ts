import { describe, expect, it } from 'vitest';

import { emptyAlertChannelConfig } from '@redis-detective/alerts';
import type { ResolvedAlertConfig } from '@redis-detective/alerts';

import { WATCH_ALERT_BANNER_DEPRECATION } from '../src/cli-alerting-deprecation.js';
import { formatWatchAlertBanner } from '../src/format-watch-alert-banner.js';

function config(overrides: Partial<ResolvedAlertConfig> = {}): ResolvedAlertConfig {
  return {
    rules: [],
    channels: emptyAlertChannelConfig(),
    cooldownMs: 3_600_000,
    severity: 'warning',
    pagerdutyMinSeverity: 'critical',
    dryRun: false,
    stateFile: null,
    ...overrides,
  };
}

describe('formatWatchAlertBanner', () => {
  it('returns nothing when no rules or channels are configured', () => {
    expect(formatWatchAlertBanner(config())).toEqual([]);
  });

  it('mentions deprecation when alerts are armed with a channel', () => {
    const lines = formatWatchAlertBanner(
      config({
        rules: [
          {
            id: 'cli',
            severity: 'warning',
            channels: [],
            thresholds: {
              growthPercent: null,
              growthBytes: null,
              ttlDropPoints: 20,
              newUntimedPatterns: false,
            },
          },
        ],
        channels: {
          ...emptyAlertChannelConfig(),
          slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x',
        },
        stateFile: './snaps/.redis-detective-alerts.json',
      }),
      './.redis-detective.yaml',
    );

    expect(lines[0]).toContain('Alerts: slack');
    expect(lines[0]).toContain('Cooldown');
    expect(lines[0]).toContain(WATCH_ALERT_BANNER_DEPRECATION);
    expect(lines).toContain('Alert config: ./.redis-detective.yaml');
    expect(lines).toContain('Alert state: ./snaps/.redis-detective-alerts.json');
  });

  it('mentions deprecation when only channels are set', () => {
    const lines = formatWatchAlertBanner(
      config({
        channels: {
          ...emptyAlertChannelConfig(),
          webhookUrl: 'https://example.com/hook',
        },
      }),
    );

    expect(lines[0]).toContain('no rules are armed');
    expect(lines).toContain(WATCH_ALERT_BANNER_DEPRECATION);
  });
});
