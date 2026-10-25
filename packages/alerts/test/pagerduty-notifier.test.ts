import { describe, expect, it } from 'vitest';

import {
  buildAlertEvent,
  createPagerdutyNotifier,
  emptySampleContext,
  sampleAlertEvent,
} from '@redis-detective/alerts';
import type { AlertFetch } from '@redis-detective/alerts';

import { TTL_DROP_FINDING, sampleRule } from './helpers/sample-finding.js';

describe('createPagerdutyNotifier', () => {
  it('skips warning events when the minimum is critical', async () => {
    const fetchImpl: AlertFetch = () => {
      throw new Error('must not be called');
    };
    const notifier = createPagerdutyNotifier({
      routingKey: 'R02EXAMPLE',
      fetchImpl,
      minSeverity: 'critical',
    });
    const event = buildAlertEvent(
      'firing',
      '2026-10-25T12:00:00.000Z',
      'redis://localhost:6379',
      sampleRule({ severity: 'warning' }),
      TTL_DROP_FINDING,
      { host: 'redis://localhost:6379', likelyCause: null, commitHints: [] },
    );

    const result = await notifier.notify(event);
    expect(result.skipped).toBe(true);
    expect(result.error).toContain('below pagerduty minimum');
  });

  it('redacts the routing key in a dry-run body', async () => {
    const notifier = createPagerdutyNotifier({
      routingKey: 'R02EXAMPLE',
      fetchImpl: () => Promise.resolve({ status: 200, body: '' }),
      dryRun: true,
    });
    const result = await notifier.notify(
      sampleAlertEvent(
        'redis://localhost:6379',
        emptySampleContext('redis://localhost:6379'),
        'critical',
      ),
    );

    expect(result.dryRunBody).toContain('"routing_key":"***"');
    expect(result.dryRunBody).not.toContain('R02EXAMPLE');
  });
});
