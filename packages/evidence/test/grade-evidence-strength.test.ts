import { describe, expect, it } from 'vitest';

import { gradeEvidenceStrength } from '@redis-detective/evidence';
import type { EvidenceStrengthInput } from '@redis-detective/evidence';

/** Everything the table needs to return 'strong'. Each test spoils exactly one input. */
const strongInput: EvidenceStrengthInput = {
  supportingSnapshotCount: 3,
  effectiveSampleRate: 0.1,
  shareOfGrowth: 0.8,
  sampleTruncated: false,
  hasCorroboratingSignal: true,
};

function grade(overrides: Partial<EvidenceStrengthInput>): string {
  return gradeEvidenceStrength({ ...strongInput, ...overrides });
}

describe('gradeEvidenceStrength', () => {
  it('returns strong only when every condition holds', () => {
    expect(gradeEvidenceStrength(strongInput)).toBe('strong');
  });

  it('never returns a number, so no score can leak into user output', () => {
    expect(['strong', 'moderate', 'unclear']).toContain(gradeEvidenceStrength(strongInput));
  });

  describe('demotes strong to moderate when one supporting condition is missing', () => {
    it('two snapshots instead of three', () => {
      expect(grade({ supportingSnapshotCount: 2 })).toBe('moderate');
    });

    it('sampling was truncated', () => {
      expect(grade({ sampleTruncated: true })).toBe('moderate');
    });

    it('nothing corroborates the finding', () => {
      expect(grade({ hasCorroboratingSignal: false })).toBe('moderate');
    });

    it('several conditions missing at once is still moderate, not unclear', () => {
      expect(grade({ supportingSnapshotCount: 2, sampleTruncated: true })).toBe('moderate');
    });
  });

  it('treats a bare majority share as a majority', () => {
    expect(grade({ shareOfGrowth: 0.5 })).toBe('strong');
    expect(grade({ shareOfGrowth: 0.499 })).toBe('unclear');
  });

  describe('returns unclear', () => {
    it('for a single snapshot, whatever else is true', () => {
      expect(grade({ supportingSnapshotCount: 1 })).toBe('unclear');
      expect(grade({ supportingSnapshotCount: 1, shareOfGrowth: 1 })).toBe('unclear');
    });

    it('for zero snapshots', () => {
      expect(grade({ supportingSnapshotCount: 0 })).toBe('unclear');
    });

    it('when the sample rate is below the usable floor', () => {
      expect(grade({ effectiveSampleRate: 0.0005 })).toBe('unclear');
      expect(grade({ effectiveSampleRate: 0 })).toBe('unclear');
    });

    it('when the finding explains less than half of what it claims', () => {
      expect(grade({ shareOfGrowth: 0.49 })).toBe('unclear');
      expect(grade({ shareOfGrowth: 0 })).toBe('unclear');
    });

    it('rather than inventing a band from a non-finite input', () => {
      expect(grade({ shareOfGrowth: Number.NaN })).toBe('unclear');
      expect(grade({ effectiveSampleRate: Number.NaN })).toBe('unclear');
      expect(grade({ shareOfGrowth: Number.POSITIVE_INFINITY })).toBe('unclear');
    });
  });

  it('sits exactly on the sample rate floor without falling through it', () => {
    expect(grade({ effectiveSampleRate: 0.001 })).toBe('strong');
  });
});
