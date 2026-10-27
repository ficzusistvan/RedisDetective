import { describe, expect, it } from 'vitest';

import { buildAlertEvent, buildSlackMessage } from '@redis-detective/alerts';

import { TTL_DROP_FINDING, sampleRule } from './helpers/sample-finding.js';

describe('buildSlackMessage', () => {
  it('builds Block Kit with pattern, change, TTL coverage, and a redacted host', () => {
    const event = buildAlertEvent(
      'firing',
      '2026-10-25T12:00:00.000Z',
      'redis://:***@prod.example:6379/',
      sampleRule(),
      TTL_DROP_FINDING,
      {
        host: 'redis://:***@prod.example:6379/',
        likelyCause: { pattern: 'session:*', description: 'TTLs disappeared' },
        commitHints: [
          { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', shortSha: 'bbbbbbb', message: 'oops' },
        ],
      },
    );
    const message = buildSlackMessage(event);
    const dumped = JSON.stringify(message);

    expect(message.text).toContain('session:*');
    expect(message.text).toContain('TTL coverage drop');
    expect(message.blocks[0]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Redis memory alert', emoji: false },
    });
    expect(dumped).toContain('96.0% → 4.0%');
    expect(dumped).toContain('redis://:***@prod.example:6379/');
    expect(dumped).toContain('TTLs disappeared');
    expect(dumped).toContain('bbbbbbb');
    expect(dumped).not.toContain('session:user-');
    expect(dumped).not.toContain('hooks.slack.com');
    expect(dumped).not.toContain('super-secret');
  });

  it('titles a resolve event as resolved', () => {
    const event = buildAlertEvent(
      'resolved',
      '2026-10-25T13:00:00.000Z',
      'redis://localhost:6379',
      sampleRule(),
      TTL_DROP_FINDING,
      { host: 'redis://localhost:6379', likelyCause: null, commitHints: [] },
    );

    expect(buildSlackMessage(event).blocks[0]?.text?.text).toBe('Redis memory alert resolved');
  });
});
