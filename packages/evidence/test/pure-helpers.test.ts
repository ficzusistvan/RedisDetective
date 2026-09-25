import { describe, expect, it } from 'vitest';

import {
  describeChange,
  readGrowthMetric,
  relativeChange,
  selectGrowthMetric,
  totalKeyCount,
  ttlCoverage,
} from '@redis-detective/evidence';

import { snapshotFixture } from './helpers/snapshot-fixture.js';

describe('relativeChange', () => {
  it('reports a fractional rise and fall', () => {
    expect(relativeChange(100, 125)).toBeCloseTo(0.25);
    expect(relativeChange(100, 50)).toBeCloseTo(-0.5);
  });

  it('is zero for no change', () => {
    expect(relativeChange(100, 100)).toBe(0);
    expect(relativeChange(0, 0)).toBe(0);
  });

  it('treats growth from zero as unbounded rather than as no change', () => {
    // Returning 0 here would make an instance filling up from empty compare as flat.
    expect(relativeChange(0, 500)).toBe(Number.POSITIVE_INFINITY);
    expect(relativeChange(0, 500)).toBeGreaterThan(0.1);
  });

  it('does not produce NaN from non-finite input', () => {
    expect(relativeChange(Number.NaN, 5)).toBe(0);
    expect(relativeChange(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('ttlCoverage', () => {
  it('is the fraction of sampled keys carrying a TTL', () => {
    expect(ttlCoverage(75, 25)).toBeCloseTo(0.75);
    expect(ttlCoverage(0, 100)).toBe(0);
    expect(ttlCoverage(100, 0)).toBe(1);
  });

  it('is null for an empty sample, not zero', () => {
    // Zero would be indistinguishable from "nothing expires", which is a leak.
    expect(ttlCoverage(0, 0)).toBeNull();
  });
});

describe('totalKeyCount', () => {
  it('sums every database', () => {
    const snapshot = snapshotFixture();
    expect(totalKeyCount(snapshot)).toBe(10_000);
  });

  it('is zero for an instance with no keyspace lines', () => {
    expect(totalKeyCount({ ...snapshotFixture(), keyspace: [] })).toBe(0);
  });
});

describe('selectGrowthMetric', () => {
  it('prefers the dataset counter when the server reports it', () => {
    expect(selectGrowthMetric([snapshotFixture()])).toBe('used_memory_dataset');
  });

  it('falls back to used_memory when the dataset figure is the samplers substitute', () => {
    const substituted = snapshotFixture({ memory: { usedMemoryDatasetBytes: 64 * 1_024 * 1_024 } });

    expect(substituted.memory.usedMemoryDatasetBytes).toBe(substituted.memory.usedMemoryBytes);
    expect(selectGrowthMetric([substituted])).toBe('used_memory');
  });

  it('falls back when even one snapshot lacks a real dataset figure', () => {
    expect(
      selectGrowthMetric([
        snapshotFixture({ snapshotId: 'a' }),
        snapshotFixture({
          snapshotId: 'b',
          memory: { usedMemoryDatasetBytes: 64 * 1_024 * 1_024 },
        }),
      ]),
    ).toBe('used_memory');
  });

  it('handles an empty list', () => {
    expect(selectGrowthMetric([])).toBe('used_memory');
  });

  it('reads whichever counter was chosen', () => {
    const snapshot = snapshotFixture();
    expect(readGrowthMetric(snapshot, 'used_memory')).toBe(snapshot.memory.usedMemoryBytes);
    expect(readGrowthMetric(snapshot, 'used_memory_dataset')).toBe(
      snapshot.memory.usedMemoryDatasetBytes,
    );
  });
});

describe('describeChange', () => {
  it('keeps quantities in raw units so the reader can check them against INFO', () => {
    expect(describeChange('used_memory', 100, 150, 'bytes')).toBe(
      'used_memory moved from 100 bytes to 150 bytes (+50.0%).',
    );
  });

  it('renders ratios to two places without a unit', () => {
    expect(describeChange('mem_fragmentation_ratio', 1.2, 1.5, 'ratio')).toBe(
      'mem_fragmentation_ratio moved from 1.20 to 1.50 (+25.0%).',
    );
  });

  it('says so plainly when growth started from zero', () => {
    expect(describeChange('evicted_keys', 0, 42, 'keys')).toContain('from zero');
  });
});
