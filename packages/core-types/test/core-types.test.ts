import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_STRENGTHS,
  NotImplementedError,
  isEvidenceStrength,
} from '@redis-detective/core-types';

describe('EvidenceStrength', () => {
  it('offers exactly three qualitative bands and no numeric score', () => {
    expect(EVIDENCE_STRENGTHS).toEqual(['strong', 'moderate', 'unclear']);
  });

  it('rejects anything that is not one of the bands', () => {
    expect(isEvidenceStrength('strong')).toBe(true);
    expect(isEvidenceStrength('unclear')).toBe(true);
    expect(isEvidenceStrength('very strong')).toBe(false);
    expect(isEvidenceStrength(0.87)).toBe(false);
    expect(isEvidenceStrength(undefined)).toBe(false);
  });
});

describe('NotImplementedError', () => {
  it('names the missing feature and carries diagnostic context', () => {
    const error = new NotImplementedError('sampleRedisState', { maxSampledKeys: 500 });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotImplementedError');
    expect(error.feature).toBe('sampleRedisState');
    expect(error.message).toContain('sampleRedisState');
    expect(error.context).toEqual({ maxSampledKeys: 500 });
  });

  it('defaults to empty context', () => {
    expect(new NotImplementedError('buildEvidenceGraph').context).toEqual({});
  });
});
