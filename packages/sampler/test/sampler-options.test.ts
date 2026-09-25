import { describe, expect, it } from 'vitest';

import {
  SAMPLER_DEFAULTS,
  SAMPLER_HARD_LIMITS,
  SamplerOptionsError,
  resolveSamplerOptions,
} from '@redis-detective/sampler';

describe('resolveSamplerOptions', () => {
  it('defaults to a safe, bounded sample', () => {
    const resolved = resolveSamplerOptions();

    expect(resolved.maxSampledKeys).toBe(SAMPLER_DEFAULTS.maxSampledKeys);
    expect(resolved.maxScanPasses).toBe(SAMPLER_DEFAULTS.maxScanPasses);
    expect(resolved.databases).toEqual([0]);
    expect(resolved.clamped).toEqual([]);
  });

  it('keeps every default at or below the hard limits', () => {
    const resolved = resolveSamplerOptions();

    expect(resolved.maxSampledKeys).toBeLessThanOrEqual(SAMPLER_HARD_LIMITS.maxSampledKeys);
    expect(resolved.maxScanPasses).toBeLessThanOrEqual(SAMPLER_HARD_LIMITS.maxScanPasses);
    expect(resolved.scanCount).toBeLessThanOrEqual(SAMPLER_HARD_LIMITS.maxScanCount);
    expect(resolved.maxDurationMs).toBeLessThanOrEqual(SAMPLER_HARD_LIMITS.maxDurationMs);
    expect(resolved.maxSampleRate).toBeLessThanOrEqual(SAMPLER_HARD_LIMITS.maxSampleRate);
  });

  // This is the assertion that keeps hard rule 1 true: an over-ambitious caller gets a safe
  // sample and a warning, never an unbounded scan.
  it('clamps an over-ambitious request instead of honouring it', () => {
    const resolved = resolveSamplerOptions({
      maxSampledKeys: 5_000_000,
      maxScanPasses: 100_000,
      scanCount: 50_000,
      maxDurationMs: 600_000,
      maxSampleRate: 1,
    });

    expect(resolved.maxSampledKeys).toBe(SAMPLER_HARD_LIMITS.maxSampledKeys);
    expect(resolved.maxScanPasses).toBe(SAMPLER_HARD_LIMITS.maxScanPasses);
    expect(resolved.scanCount).toBe(SAMPLER_HARD_LIMITS.maxScanCount);
    expect(resolved.maxDurationMs).toBe(SAMPLER_HARD_LIMITS.maxDurationMs);
    expect(resolved.maxSampleRate).toBe(SAMPLER_HARD_LIMITS.maxSampleRate);
  });

  it('reports each clamp so the user can be told the sample was reduced', () => {
    const resolved = resolveSamplerOptions({ maxSampledKeys: 5_000_000 });

    expect(resolved.clamped).toHaveLength(1);
    expect(resolved.clamped[0]).toContain('maxSampledKeys');
  });

  it('accepts in-range overrides untouched', () => {
    const resolved = resolveSamplerOptions({ maxSampledKeys: 250, patternDepth: 3 });

    expect(resolved.maxSampledKeys).toBe(250);
    expect(resolved.patternDepth).toBe(3);
    expect(resolved.clamped).toEqual([]);
  });

  it('deduplicates and sorts database indexes', () => {
    const resolved = resolveSamplerOptions({ databases: [2, 0, 2] });

    expect(resolved.databases).toEqual([0, 2]);
    expect(resolved.clamped).toContain('duplicate database indexes were removed');
  });

  it('rejects structurally invalid input rather than clamping it', () => {
    expect(() => resolveSamplerOptions({ maxSampledKeys: 0 })).toThrow(SamplerOptionsError);
    expect(() => resolveSamplerOptions({ maxSampledKeys: -1 })).toThrow(SamplerOptionsError);
    expect(() => resolveSamplerOptions({ maxSampledKeys: 1.5 })).toThrow(SamplerOptionsError);
    expect(() => resolveSamplerOptions({ maxSampledKeys: Number.NaN })).toThrow(
      SamplerOptionsError,
    );
    expect(() => resolveSamplerOptions({ databases: [] })).toThrow(SamplerOptionsError);
    expect(() => resolveSamplerOptions({ databases: [-1] })).toThrow(SamplerOptionsError);
  });

  it('is a pure function of its input', () => {
    const options = { maxSampledKeys: 250, databases: [1, 0] };
    const first = resolveSamplerOptions(options);
    const second = resolveSamplerOptions(options);

    expect(first).toEqual(second);
    expect(options.databases).toEqual([1, 0]);
  });
});
