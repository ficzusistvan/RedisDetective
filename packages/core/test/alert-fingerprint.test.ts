import { describe, expect, it } from 'vitest';

import { alertFingerprint, pagerdutyDedupKey } from '@redis-detective/core';

/**
 * Goldens captured from Node `createHash('sha256')` so 0.7.0 fingerprints match 0.6.x.
 * A restarted watch must still resolve a PagerDuty incident opened by an older CLI.
 */
const GOLDENS = [
  {
    host: 'redis://localhost:6379/',
    pattern: 'session:*',
    ruleId: 'cli',
    kind: 'ttl-coverage-drop' as const,
    fingerprint: 'f8cdc3529c887e8b38d0c4ba06321f35fae6ccd6d3b6b5ee1d55a463acf414fc',
    dedupKey: 'rdv1:f8cdc3529c887e8b38d0c4ba06321f35fae6ccd6',
  },
  {
    host: 'redis://prod.example:6379',
    pattern: 'cache:user:*',
    ruleId: 'growth',
    kind: 'pattern-growth' as const,
    fingerprint: 'f1bd03614576b3f7d9009c136aef9cfbb10eda0a96c19218654d9cf9cf98589d',
    dedupKey: 'rdv1:f1bd03614576b3f7d9009c136aef9cfbb10eda0a',
  },
  {
    host: 'redis://localhost:6379',
    pattern: 'cart:items:*',
    ruleId: 'ttl-drop',
    kind: 'ttl-coverage-drop' as const,
    fingerprint: '78610123e83cbf4d6060230cb578caaeac67e35352e551f20efa6816d4020a28',
    dedupKey: 'rdv1:78610123e83cbf4d6060230cb578caaeac67e353',
  },
  {
    host: '',
    pattern: '*',
    ruleId: 'cli',
    kind: 'new-untimed-pattern' as const,
    fingerprint: '76d94aeaa1ec04f7dcebf1cc1024b02b04cec8c56dc3309283770231b091537d',
    dedupKey: 'rdv1:76d94aeaa1ec04f7dcebf1cc1024b02b04cec8c5',
  },
] as const;

describe('alertFingerprint / pagerdutyDedupKey', () => {
  it('matches the 0.6.x node:crypto SHA-256 vectors', () => {
    for (const golden of GOLDENS) {
      const identity = {
        host: golden.host,
        pattern: golden.pattern,
        ruleId: golden.ruleId,
        kind: golden.kind,
      };
      expect(alertFingerprint(identity), JSON.stringify(identity)).toBe(golden.fingerprint);
      expect(pagerdutyDedupKey(identity)).toBe(golden.dedupKey);
      expect(pagerdutyDedupKey(identity)).toBe(`rdv1:${golden.fingerprint.slice(0, 40)}`);
    }
  });

  it('changes when the pattern or rule changes', () => {
    const base = GOLDENS[0];
    const identity = {
      host: base.host,
      pattern: base.pattern,
      ruleId: base.ruleId,
      kind: base.kind,
    };
    expect(alertFingerprint({ ...identity, pattern: 'cache:*' })).not.toBe(base.fingerprint);
    expect(alertFingerprint({ ...identity, ruleId: 'growth' })).not.toBe(base.fingerprint);
  });
});
