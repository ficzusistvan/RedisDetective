import { describe, expect, it } from 'vitest';

import { gradeFindingStrength, measuredFindingStrength } from '@redis-detective/cli';
import type { FindingStrengthInput } from '@redis-detective/cli';

function input(overrides: Partial<FindingStrengthInput> = {}): FindingStrengthInput {
  return {
    effectiveSampleRate: 0.1,
    sampleTruncated: false,
    estimateBasis: 'sampled-extrapolation',
    sampledKeyCount: 500,
    ...overrides,
  };
}

describe('gradeFindingStrength', () => {
  it('calls a fully measured key space strong', () => {
    expect(gradeFindingStrength(input({ estimateBasis: 'exact', sampledKeyCount: 3 }))).toBe(
      'strong',
    );
  });

  it('calls a broad sample of many keys strong', () => {
    expect(gradeFindingStrength(input({ effectiveSampleRate: 0.1, sampledKeyCount: 500 }))).toBe(
      'strong',
    );
  });

  it('calls a thinner sample moderate', () => {
    expect(gradeFindingStrength(input({ effectiveSampleRate: 0.01 }))).toBe('moderate');
  });

  it('calls a very thin sample unclear', () => {
    expect(gradeFindingStrength(input({ effectiveSampleRate: 0.0001 }))).toBe('unclear');
  });

  // A handful of keys swings the numbers too far to support any claim.
  it('calls a finding backed by few keys unclear however broad the sample', () => {
    expect(gradeFindingStrength(input({ sampledKeyCount: 5, effectiveSampleRate: 0.9 }))).toBe(
      'unclear',
    );
  });

  it('downgrades anything from a truncated scan', () => {
    expect(gradeFindingStrength(input({ sampleTruncated: true, effectiveSampleRate: 0.5 }))).toBe(
      'unclear',
    );
  });

  // Truncation means the scan stopped early, so even a full pass is no longer exact.
  it('does not call a truncated exhaustive scan strong', () => {
    expect(
      gradeFindingStrength(
        input({ estimateBasis: 'exact', sampleTruncated: true, sampledKeyCount: 5 }),
      ),
    ).toBe('unclear');
  });

  it('only ever returns a qualitative band', () => {
    const bands = new Set(
      [0, 0.0001, 0.006, 0.2, 1].map((rate) =>
        gradeFindingStrength(input({ effectiveSampleRate: rate })),
      ),
    );

    for (const band of bands) {
      expect(['strong', 'moderate', 'unclear']).toContain(band);
    }
  });
});

describe('measuredFindingStrength', () => {
  it('is strong, because INFO counters are measured rather than extrapolated', () => {
    expect(measuredFindingStrength()).toBe('strong');
  });
});
