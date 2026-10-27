import { describe, expect, it } from 'vitest';

import { buildAlertEvent, buildAlertPayload } from '@redis-detective/alerts';

import { GROWTH_FINDING, TTL_DROP_FINDING, sampleRule } from './helpers/sample-finding.js';

const HOST = 'redis://:***@prod.example:6379/';

describe('buildAlertPayload', () => {
  it('emits a versioned firing payload with TTL coverage and no example keys', () => {
    const event = buildAlertEvent(
      'firing',
      '2026-10-25T12:00:00.000Z',
      HOST,
      sampleRule(),
      TTL_DROP_FINDING,
      {
        host: HOST,
        likelyCause: { pattern: 'session:*', description: 'TTLs disappeared on session:*' },
        commitHints: [
          {
            sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            shortSha: 'aaaaaaa',
            message: 'drop EX',
          },
        ],
      },
    );
    const payload = buildAlertPayload(event);

    expect(payload).toEqual({
      schemaVersion: 1,
      event: 'firing',
      occurredAt: '2026-10-25T12:00:00.000Z',
      host: HOST,
      pattern: 'session:*',
      dedupKey: event.dedupKey,
      rule: { id: 'ttl-drop', kind: 'ttl-coverage-drop', severity: 'critical' },
      change: {
        summary: 'TTL coverage drop',
        growthBytes: null,
        growthPercent: null,
        ttlCoverageBefore: 0.96,
        ttlCoverageAfter: 0.04,
      },
      likelyCause: { pattern: 'session:*', description: 'TTLs disappeared on session:*' },
      commitHints: [
        {
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          shortSha: 'aaaaaaa',
          message: 'drop EX',
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/session:[a-z0-9]{6}/);
    expect(JSON.stringify(payload)).not.toContain('hooks.slack.com');
    expect(JSON.stringify(payload)).not.toContain('routing_key');
  });

  it('includes growth bytes and percent for a pattern-growth finding', () => {
    const event = buildAlertEvent(
      'resolved',
      '2026-10-25T13:00:00.000Z',
      HOST,
      sampleRule({ id: 'growth', severity: 'warning' }),
      GROWTH_FINDING,
      { host: HOST, likelyCause: null, commitHints: [] },
    );
    const payload = buildAlertPayload(event);

    expect(payload.event).toBe('resolved');
    expect(payload.change).toEqual({
      summary: 'pattern memory growth',
      growthBytes: 10_000_000,
      growthPercent: 100,
      ttlCoverageBefore: null,
      ttlCoverageAfter: null,
    });
  });
});
