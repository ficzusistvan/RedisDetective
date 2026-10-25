import { describe, expect, it } from 'vitest';

import { alertFingerprint, pagerdutyDedupKey } from '@redis-detective/alerts';

const identity = {
  host: 'redis://localhost:6379/',
  pattern: 'session:*',
  ruleId: 'cli',
  kind: 'ttl-coverage-drop' as const,
};

describe('pagerdutyDedupKey', () => {
  it('is stable for the same host, pattern, and rule', () => {
    expect(pagerdutyDedupKey(identity)).toBe(pagerdutyDedupKey(identity));
    expect(pagerdutyDedupKey(identity)).toMatch(/^rdv1:[0-9a-f]{40}$/);
  });

  it('changes when the pattern or rule changes', () => {
    const otherPattern = pagerdutyDedupKey({ ...identity, pattern: 'cache:*' });
    const otherRule = pagerdutyDedupKey({ ...identity, ruleId: 'growth' });

    expect(otherPattern).not.toBe(pagerdutyDedupKey(identity));
    expect(otherRule).not.toBe(pagerdutyDedupKey(identity));
  });

  it('shares its hash with the state-file fingerprint', () => {
    const key = pagerdutyDedupKey(identity);
    expect(key.slice('rdv1:'.length)).toBe(alertFingerprint(identity).slice(0, 40));
  });
});
