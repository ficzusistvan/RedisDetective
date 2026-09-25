import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_DEFAULTS,
  EvidenceOptionsError,
  resolveEvidenceOptions,
} from '@redis-detective/evidence';

describe('resolveEvidenceOptions', () => {
  it('fills in every default', () => {
    const resolved = resolveEvidenceOptions();

    expect(resolved.minGrowthBytes).toBe(EVIDENCE_DEFAULTS.minGrowthBytes);
    expect(resolved.minGrowthRatio).toBe(EVIDENCE_DEFAULTS.minGrowthRatio);
    expect(resolved.maxAttributionsPerAnomaly).toBe(EVIDENCE_DEFAULTS.maxAttributionsPerAnomaly);
  });

  it('keeps caller overrides', () => {
    const resolved = resolveEvidenceOptions({ minGrowthBytes: 1_024, minGrowthRatio: 0.5 });

    expect(resolved.minGrowthBytes).toBe(1_024);
    expect(resolved.minGrowthRatio).toBe(0.5);
  });

  it('rejects thresholds that have no sensible interpretation', () => {
    expect(() => resolveEvidenceOptions({ minGrowthBytes: -1 })).toThrow(EvidenceOptionsError);
    expect(() => resolveEvidenceOptions({ minGrowthRatio: 1.5 })).toThrow(EvidenceOptionsError);
    expect(() => resolveEvidenceOptions({ minAttributionShare: 2 })).toThrow(EvidenceOptionsError);
    expect(() => resolveEvidenceOptions({ maxAttributionsPerAnomaly: 2.5 })).toThrow(
      EvidenceOptionsError,
    );
    expect(() => resolveEvidenceOptions({ minGrowthBytes: Number.POSITIVE_INFINITY })).toThrow(
      EvidenceOptionsError,
    );
  });

  it('is deterministic for identical input', () => {
    expect(resolveEvidenceOptions({ minGrowthRatio: 0.2 })).toEqual(
      resolveEvidenceOptions({ minGrowthRatio: 0.2 }),
    );
  });
});
