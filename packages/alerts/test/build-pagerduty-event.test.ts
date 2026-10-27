import { describe, expect, it } from 'vitest';

import { buildAlertEvent, buildPagerdutyEvent, pagerdutyDedupKey } from '@redis-detective/alerts';

import { TTL_DROP_FINDING, sampleRule } from './helpers/sample-finding.js';

const HOST = 'redis://localhost:6379/';
const identity = {
  host: HOST,
  pattern: 'session:*',
  ruleId: 'ttl-drop',
  kind: 'ttl-coverage-drop' as const,
};

describe('buildPagerdutyEvent', () => {
  it('triggers with a stable dedup_key and mapped severity', () => {
    const event = buildAlertEvent(
      'firing',
      '2026-10-25T12:00:00.000Z',
      HOST,
      sampleRule(),
      TTL_DROP_FINDING,
      { host: HOST, likelyCause: null, commitHints: [] },
    );
    const body = buildPagerdutyEvent(event, 'R02EXAMPLEKEY');

    expect(body.event_action).toBe('trigger');
    expect(body.dedup_key).toBe(pagerdutyDedupKey(identity));
    expect(body.payload.severity).toBe('critical');
    expect(body.payload.source).toBe(HOST);
    expect(body.payload.custom_details).toMatchObject({ pattern: 'session:*' });
    expect(JSON.stringify(body.payload.custom_details)).not.toContain('R02EXAMPLEKEY');
  });

  it('sends resolve with the same dedup_key', () => {
    const firing = buildAlertEvent(
      'firing',
      '2026-10-25T12:00:00.000Z',
      HOST,
      sampleRule(),
      TTL_DROP_FINDING,
      { host: HOST, likelyCause: null, commitHints: [] },
    );
    const resolved = buildAlertEvent(
      'resolved',
      '2026-10-25T13:00:00.000Z',
      HOST,
      sampleRule(),
      TTL_DROP_FINDING,
      { host: HOST, likelyCause: null, commitHints: [] },
    );

    expect(buildPagerdutyEvent(resolved, 'R02EXAMPLEKEY').event_action).toBe('resolve');
    expect(buildPagerdutyEvent(resolved, 'R02EXAMPLEKEY').dedup_key).toBe(
      buildPagerdutyEvent(firing, 'R02EXAMPLEKEY').dedup_key,
    );
  });
});
