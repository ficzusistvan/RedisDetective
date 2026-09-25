import { describe, expect, it } from 'vitest';

import { aggregateKeyPatterns, resolveSamplerOptions } from '@redis-detective/sampler';
import type { SampledKey } from '@redis-detective/sampler';

const options = resolveSamplerOptions();

function sampled(overrides: Partial<SampledKey> & Pick<SampledKey, 'key'>): SampledKey {
  return {
    db: 0,
    dataType: 'string',
    serializedBytes: 100,
    ttlMs: null,
    ...overrides,
  };
}

describe('aggregateKeyPatterns', () => {
  it('groups sibling keys under one pattern', () => {
    const stats = aggregateKeyPatterns({
      keys: [
        sampled({ key: 'session:1' }),
        sampled({ key: 'session:2' }),
        sampled({ key: 'cart:9' }),
      ],
      keyspaceSize: 3,
      options,
      exhaustive: true,
    });

    expect(stats).toHaveLength(2);
    expect(stats.map((entry) => entry.pattern).sort()).toEqual(['cart:*', 'session:*']);
    expect(stats.find((entry) => entry.pattern === 'session:*')?.sampledKeyCount).toBe(2);
  });

  it('keeps different data types under the same pattern apart', () => {
    const stats = aggregateKeyPatterns({
      keys: [
        sampled({ key: 'item:1', dataType: 'string' }),
        sampled({ key: 'item:2', dataType: 'hash' }),
      ],
      keyspaceSize: 2,
      options,
      exhaustive: true,
    });

    expect(stats).toHaveLength(2);
    expect(new Set(stats.map((entry) => entry.dataType))).toEqual(new Set(['string', 'hash']));
  });

  it('extrapolates counts and bytes to the whole key space', () => {
    const stats = aggregateKeyPatterns({
      keys: [sampled({ key: 'session:1', serializedBytes: 100 })],
      keyspaceSize: 1_000,
      options,
      exhaustive: false,
    });

    expect(stats[0]?.sampledKeyCount).toBe(1);
    expect(stats[0]?.sampledBytes).toBe(100);
    expect(stats[0]?.estimatedKeyCount).toBe(1_000);
    expect(stats[0]?.estimatedBytes).toBe(100_000);
  });

  // Presenting an extrapolation as a measurement is the specific dishonesty this guards against.
  it('labels extrapolated figures as estimates and exhaustive ones as exact', () => {
    const estimated = aggregateKeyPatterns({
      keys: [sampled({ key: 'session:1' })],
      keyspaceSize: 1_000,
      options,
      exhaustive: false,
    });
    const exact = aggregateKeyPatterns({
      keys: [sampled({ key: 'session:1' })],
      keyspaceSize: 1,
      options,
      exhaustive: true,
    });

    expect(estimated[0]?.estimateBasis).toBe('sampled-extrapolation');
    expect(exact[0]?.estimateBasis).toBe('exact');
    expect(exact[0]?.estimatedBytes).toBe(100);
  });

  it('counts TTL coverage and the median TTL', () => {
    const stats = aggregateKeyPatterns({
      keys: [
        sampled({ key: 'session:1', ttlMs: 10_000 }),
        sampled({ key: 'session:2', ttlMs: 30_000 }),
        sampled({ key: 'session:3', ttlMs: null }),
      ],
      keyspaceSize: 3,
      options,
      exhaustive: true,
    });

    expect(stats[0]?.keysWithTtl).toBe(2);
    expect(stats[0]?.keysWithoutTtl).toBe(1);
    expect(stats[0]?.medianTtlSeconds).toBe(20);
  });

  it('reports a null median when no sampled key has a TTL', () => {
    const stats = aggregateKeyPatterns({
      keys: [sampled({ key: 'leak:1' })],
      keyspaceSize: 1,
      options,
      exhaustive: true,
    });

    expect(stats[0]?.medianTtlSeconds).toBeNull();
    expect(stats[0]?.keysWithoutTtl).toBe(1);
  });

  // Zero bytes and "nobody could measure this" must stay distinguishable downstream.
  it('flags a pattern whose bytes could not be measured', () => {
    const stats = aggregateKeyPatterns({
      keys: [sampled({ key: 'session:1', serializedBytes: null })],
      keyspaceSize: 1,
      options,
      exhaustive: true,
    });

    expect(stats[0]?.sampledBytes).toBe(0);
    expect(stats[0]?.sampledKeyCount).toBe(1);
    expect(stats[0]?.bytesMeasured).toBe(false);
  });

  it('counts a pattern as measured when any sampled key returned a size', () => {
    const stats = aggregateKeyPatterns({
      keys: [
        sampled({ key: 'session:1', serializedBytes: null }),
        sampled({ key: 'session:2', serializedBytes: 400 }),
      ],
      keyspaceSize: 2,
      options,
      exhaustive: true,
    });

    expect(stats[0]?.bytesMeasured).toBe(true);
    expect(stats[0]?.sampledBytes).toBe(400);
  });

  it('caps the example keys it retains', () => {
    const stats = aggregateKeyPatterns({
      keys: Array.from({ length: 20 }, (_unused, index) => sampled({ key: `session:${index}` })),
      keyspaceSize: 20,
      options,
      exhaustive: true,
    });

    expect(stats[0]?.exampleKeys).toHaveLength(3);
  });

  it('sorts by estimated bytes descending, with every tie broken explicitly', () => {
    const stats = aggregateKeyPatterns({
      keys: [
        sampled({ key: 'small:1', serializedBytes: 10 }),
        sampled({ key: 'big:1', serializedBytes: 5_000 }),
        sampled({ key: 'medium:1', serializedBytes: 500 }),
      ],
      keyspaceSize: 3,
      options,
      exhaustive: true,
    });

    expect(stats.map((entry) => entry.pattern)).toEqual(['big:*', 'medium:*', 'small:*']);
  });

  it('is deterministic and pure', () => {
    const keys = [sampled({ key: 'a:1' }), sampled({ key: 'b:1' })];
    const input = { keys, keyspaceSize: 2, options, exhaustive: true };

    expect(aggregateKeyPatterns(input)).toEqual(aggregateKeyPatterns(input));
    expect(keys.map((key) => key.key)).toEqual(['a:1', 'b:1']);
  });

  it('handles an empty sample', () => {
    expect(aggregateKeyPatterns({ keys: [], keyspaceSize: 0, options, exhaustive: true })).toEqual(
      [],
    );
  });
});
