import { describe, expect, it } from 'vitest';

import { detectMemoryAnomalies, resolveEvidenceOptions } from '@redis-detective/evidence';

import { hoursIn, series, snapshotFixture } from './helpers/snapshot-fixture.js';

const options = resolveEvidenceOptions();
const MB = 1_024 * 1_024;

function kinds(snapshots: Parameters<typeof detectMemoryAnomalies>[0]): readonly string[] {
  return detectMemoryAnomalies(snapshots, options).map((anomaly) => anomaly.kind);
}

describe('detectMemoryAnomalies', () => {
  describe('does nothing to report', () => {
    it('for an empty list', () => {
      expect(detectMemoryAnomalies([], options)).toEqual([]);
    });

    it('for a single snapshot, which cannot show a change', () => {
      expect(detectMemoryAnomalies([snapshotFixture()], options)).toEqual([]);
    });

    it('for a flat series', () => {
      expect(detectMemoryAnomalies(series([64 * MB, 64 * MB, 64 * MB]), options)).toEqual([]);
    });

    it('for growth that clears the ratio but not the absolute floor', () => {
      // 40% of 4 MB is not a memory problem, however dramatic the percentage looks.
      expect(detectMemoryAnomalies(series([4 * MB, 5.6 * MB]), options)).toEqual([]);
    });

    it('for growth that clears the absolute floor but not the ratio', () => {
      expect(detectMemoryAnomalies(series([4_096 * MB, 4_140 * MB]), options)).toEqual([]);
    });

    it('for a shrinking series', () => {
      expect(detectMemoryAnomalies(series([192 * MB, 64 * MB]), options)).toEqual([]);
    });

    it('for a resident zero between two readings, which is not the dataset emptying', () => {
      const anomalies = detectMemoryAnomalies(
        [
          snapshotFixture({
            snapshotId: 'warm-before',
            capturedAt: hoursIn(0),
            usedMemoryBytes: 64 * MB,
          }),
          snapshotFixture({ snapshotId: 'cold', capturedAt: hoursIn(1), usedMemoryBytes: 0 }),
          snapshotFixture({
            snapshotId: 'warm-after',
            capturedAt: hoursIn(2),
            usedMemoryBytes: 64 * MB,
          }),
        ],
        options,
      );

      expect(anomalies).toEqual([]);
    });

    it('for a missing used_memory followed by a real reading', () => {
      const anomalies = detectMemoryAnomalies(
        [
          snapshotFixture({ snapshotId: 'missing', capturedAt: hoursIn(0), usedMemoryBytes: null }),
          snapshotFixture({
            snapshotId: 'later',
            capturedAt: hoursIn(1),
            usedMemoryBytes: 192 * MB,
          }),
        ],
        options,
      );

      expect(anomalies.map((anomaly) => anomaly.kind)).not.toContain('memory-step-change');
    });
  });

  describe('memory-step-change', () => {
    it('still reports growth that started from a genuinely empty instance', () => {
      const anomalies = detectMemoryAnomalies(
        [
          snapshotFixture({
            snapshotId: 'empty',
            capturedAt: hoursIn(0),
            usedMemoryBytes: 0,
            keyCount: 0,
            patterns: [],
          }),
          snapshotFixture({ snapshotId: 'full', capturedAt: hoursIn(1), usedMemoryBytes: 64 * MB }),
        ],
        options,
      );
      const step = anomalies.find((anomaly) => anomaly.kind === 'memory-step-change');

      expect(step?.snapshotIdBefore).toBe('empty');
      expect(step?.valueBefore).toBe(0);
      expect(step?.observations.join(' ')).toContain('from zero');
    });

    it('compares the stored-size readings on either side of a resident zero', () => {
      const anomalies = detectMemoryAnomalies(
        [
          snapshotFixture({
            snapshotId: 'warm-before',
            capturedAt: hoursIn(0),
            usedMemoryBytes: 64 * MB,
          }),
          snapshotFixture({ snapshotId: 'cold', capturedAt: hoursIn(1), usedMemoryBytes: 0 }),
          snapshotFixture({
            snapshotId: 'warm-after',
            capturedAt: hoursIn(2),
            usedMemoryBytes: 192 * MB,
          }),
        ],
        options,
      );
      const step = anomalies.find((anomaly) => anomaly.kind === 'memory-step-change');

      expect(step?.snapshotIdBefore).toBe('warm-before');
      expect(step?.snapshotIdAfter).toBe('warm-after');
      expect(step?.valueBefore).toBe(64 * MB);
      expect(step?.valueAfter).toBe(192 * MB);
      expect(step?.observations.join(' ')).not.toContain('from zero');
    });

    it('reports a single-interval jump against the dataset counter', () => {
      const anomalies = detectMemoryAnomalies(series([64 * MB, 192 * MB]), options);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.kind).toBe('memory-step-change');
      expect(anomalies[0]?.metric).toBe('used_memory_dataset');
      expect(anomalies[0]?.snapshotIdBefore).toBe('snapshot-1');
      expect(anomalies[0]?.snapshotIdAfter).toBe('snapshot-2');
      expect(anomalies[0]?.window).toEqual({ from: hoursIn(0), to: hoursIn(1) });
    });

    it('records a byte delta and cites the counter it measured', () => {
      const anomaly = detectMemoryAnomalies(series([64 * MB, 192 * MB]), options)[0];

      expect(anomaly?.deltaBytes).toBe((anomaly?.valueAfter ?? 0) - (anomaly?.valueBefore ?? 0));
      expect(anomaly?.observations.join(' ')).toContain('used_memory_dataset moved from');
      expect(anomaly?.observations.join(' ')).toContain('step rather than a trend');
    });

    it('cannot be strong on two snapshots alone', () => {
      const anomaly = detectMemoryAnomalies(series([64 * MB, 192 * MB]), options)[0];

      expect(anomaly?.evidenceStrength).toBe('moderate');
    });

    it('is reported instead of a trend, so the same bytes are not counted twice', () => {
      // Rises every interval, but one interval is a step. The step is the finding.
      const detected = kinds(series([64 * MB, 66 * MB, 200 * MB, 202 * MB]));

      expect(detected).toContain('memory-step-change');
      expect(detected).not.toContain('memory-growth');
    });
  });

  describe('memory-growth', () => {
    it('reports a sustained rise across three or more snapshots', () => {
      const anomalies = detectMemoryAnomalies(
        series([64 * MB, 72 * MB, 80 * MB, 88 * MB]),
        options,
      );

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.kind).toBe('memory-growth');
      expect(anomalies[0]?.snapshotIdBefore).toBe('snapshot-1');
      expect(anomalies[0]?.snapshotIdAfter).toBe('snapshot-4');
      expect(anomalies[0]?.observations.join(' ')).toContain(
        'rose in every one of the 3 intervals',
      );
    });

    it('needs three snapshots, not two', () => {
      // Same per-interval rise, one snapshot short of a trend and too small to be a step.
      expect(kinds(series([64 * MB, 72 * MB]))).toEqual([]);
    });

    it('stops the run at the first interval that does not rise', () => {
      expect(kinds(series([64 * MB, 72 * MB, 70 * MB, 78 * MB]))).toEqual([]);
    });

    it('is strong when the key count corroborates it', () => {
      const rising = [64 * MB, 72 * MB, 80 * MB, 88 * MB].map((bytes, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: bytes,
          keyCount: 10_000 + index * 5_000,
        }),
      );

      const anomalies = detectMemoryAnomalies(rising, options);
      const growth = anomalies.find((anomaly) => anomaly.kind === 'memory-growth');

      expect(growth?.evidenceStrength).toBe('strong');
    });

    it('is only moderate when nothing corroborates it', () => {
      const anomaly = detectMemoryAnomalies(
        series([64 * MB, 72 * MB, 80 * MB, 88 * MB]),
        options,
      )[0];

      expect(anomaly?.evidenceStrength).toBe('moderate');
    });

    it('is held back to moderate when a bound cut sampling short', () => {
      const truncated = [64 * MB, 72 * MB, 80 * MB, 88 * MB].map((bytes, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: bytes,
          sampling: { truncated: true },
        }),
      );

      expect(detectMemoryAnomalies(truncated, options)[0]?.evidenceStrength).toBe('moderate');
    });
  });

  describe('key-count-growth', () => {
    it('reports keys outpacing bytes', () => {
      const snapshots = [10_000, 30_000].map((keyCount, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: 64 * MB,
          keyCount,
        }),
      );

      const anomalies = detectMemoryAnomalies(snapshots, options);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.kind).toBe('key-count-growth');
      expect(anomalies[0]?.metric).toBe('key_count');
      expect(anomalies[0]?.valueBefore).toBe(10_000);
      expect(anomalies[0]?.valueAfter).toBe(30_000);
    });

    it('carries no byte delta, because it counts keys', () => {
      const snapshots = [10_000, 30_000].map((keyCount, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          keyCount,
        }),
      );

      expect(detectMemoryAnomalies(snapshots, options)[0]?.deltaBytes).toBeNull();
    });

    it('stays quiet when bytes grow at least as fast as keys', () => {
      const snapshots = [
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), keyCount: 10_000 }),
        snapshotFixture({
          snapshotId: 'b',
          capturedAt: hoursIn(1),
          keyCount: 11_000,
          usedMemoryBytes: 192 * MB,
        }),
      ];

      expect(kinds(snapshots)).not.toContain('key-count-growth');
    });
  });

  describe('fragmentation-growth', () => {
    it('reports the allocator pulling away while stored data is flat', () => {
      const snapshots = [1.2, 1.6].map((ratio, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: 64 * MB,
          memory: { memFragmentationRatio: ratio, usedMemoryRssBytes: 64 * MB * ratio },
        }),
      );

      const anomalies = detectMemoryAnomalies(snapshots, options);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.kind).toBe('fragmentation-growth');
      expect(anomalies[0]?.metric).toBe('mem_fragmentation_ratio');
      expect(anomalies[0]?.deltaBytes).toBeNull();
      expect(anomalies[0]?.observations.join(' ')).toContain('allocator overhead rather than new');
    });

    it('stays quiet when the data grew too, since that is ordinary allocator behaviour', () => {
      const snapshots = [
        snapshotFixture({
          snapshotId: 'a',
          capturedAt: hoursIn(0),
          usedMemoryBytes: 64 * MB,
          memory: { memFragmentationRatio: 1.2 },
        }),
        snapshotFixture({
          snapshotId: 'b',
          capturedAt: hoursIn(1),
          usedMemoryBytes: 192 * MB,
          memory: { memFragmentationRatio: 1.6 },
        }),
      ];

      expect(kinds(snapshots)).not.toContain('fragmentation-growth');
    });
  });

  describe('eviction-onset', () => {
    it('reports the interval in which evictions started', () => {
      const snapshots = [0, 5_000].map((evictedKeys, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          memory: { evictedKeys },
          instance: { maxmemoryPolicy: 'allkeys-lru' },
        }),
      );

      const anomalies = detectMemoryAnomalies(snapshots, options);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.kind).toBe('eviction-onset');
      expect(anomalies[0]?.metric).toBe('evicted_keys');
      expect(anomalies[0]?.deltaBytes).toBeNull();
      expect(anomalies[0]?.observations.join(' ')).toContain('allkeys-lru');
    });

    it('does not re-report an instance that was already evicting', () => {
      const snapshots = [5_000, 9_000].map((evictedKeys, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          memory: { evictedKeys },
        }),
      );

      expect(kinds(snapshots)).toEqual([]);
    });

    it('says so when no maxmemory is configured', () => {
      const snapshots = [0, 10].map((evictedKeys, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          memory: { evictedKeys },
          instance: { maxmemoryBytes: null },
        }),
      );

      expect(detectMemoryAnomalies(snapshots, options)[0]?.observations.join(' ')).toContain(
        'No maxmemory is configured',
      );
    });
  });

  describe('interval bounds', () => {
    it('skips an interval longer than maxSnapshotGapMs rather than mislabelling it', () => {
      const snapshots = [
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), usedMemoryBytes: 64 * MB }),
        snapshotFixture({ snapshotId: 'b', capturedAt: hoursIn(7), usedMemoryBytes: 192 * MB }),
      ];

      expect(detectMemoryAnomalies(snapshots, options)).toEqual([]);
    });

    it('still analyses an interval right at the limit', () => {
      const snapshots = [
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), usedMemoryBytes: 64 * MB }),
        snapshotFixture({ snapshotId: 'b', capturedAt: hoursIn(6), usedMemoryBytes: 192 * MB }),
      ];

      expect(kinds(snapshots)).toEqual(['memory-step-change']);
    });

    it('does not bridge a run across a dropped interval', () => {
      const snapshots = [
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), usedMemoryBytes: 64 * MB }),
        snapshotFixture({ snapshotId: 'b', capturedAt: hoursIn(1), usedMemoryBytes: 72 * MB }),
        // Ten hours later: the interval is dropped, so the run cannot continue through it.
        snapshotFixture({ snapshotId: 'c', capturedAt: hoursIn(11), usedMemoryBytes: 80 * MB }),
        snapshotFixture({ snapshotId: 'd', capturedAt: hoursIn(12), usedMemoryBytes: 88 * MB }),
      ];

      expect(kinds(snapshots)).toEqual([]);
    });
  });

  describe('reports one anomaly per span, not one per sub-interval', () => {
    it('collapses a steady key-count rise into a single event over the whole window', () => {
      // Three rising intervals. Reported three times, a reader would have to work out for themselves
      // that they were looking at one problem counted repeatedly.
      const snapshots = [10_000, 40_000, 70_000, 100_000].map((keyCount, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: 64 * MB,
          keyCount,
        }),
      );

      const anomalies = detectMemoryAnomalies(snapshots, options);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.kind).toBe('key-count-growth');
      expect(anomalies[0]?.valueBefore).toBe(10_000);
      expect(anomalies[0]?.valueAfter).toBe(100_000);
      expect(anomalies[0]?.window).toEqual({ from: hoursIn(0), to: hoursIn(3) });
    });

    it('splits into two events when the metric falls back in the middle', () => {
      const snapshots = [10_000, 40_000, 20_000, 60_000].map((keyCount, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: 64 * MB,
          keyCount,
        }),
      );

      const anomalies = detectMemoryAnomalies(snapshots, options);

      expect(anomalies).toHaveLength(2);
      expect(anomalies.map((anomaly) => anomaly.valueAfter)).toEqual([40_000, 60_000]);
    });

    it('collapses a steady fragmentation rise into a single event', () => {
      const snapshots = [1.2, 1.4, 1.6, 1.8].map((ratio, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: 64 * MB,
          memory: { memFragmentationRatio: ratio, usedMemoryRssBytes: 64 * MB * ratio },
        }),
      );

      const anomalies = detectMemoryAnomalies(snapshots, options);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.kind).toBe('fragmentation-growth');
      expect(anomalies[0]?.valueAfter).toBeCloseTo(1.8);
    });

    it('reports a rising memory trend and a rising key count as one event each', () => {
      const snapshots = [64 * MB, 72 * MB, 80 * MB, 88 * MB].map((bytes, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          usedMemoryBytes: bytes,
          keyCount: 10_000 + index * 30_000,
        }),
      );

      expect(kinds(snapshots)).toEqual(['key-count-growth', 'memory-growth']);
    });

    it('still reports the onset of eviction per interval, since that is a moment not a span', () => {
      const snapshots = [0, 0, 500, 900].map((evictedKeys, index) =>
        snapshotFixture({
          snapshotId: `snapshot-${index + 1}`,
          capturedAt: hoursIn(index),
          memory: { evictedKeys },
        }),
      );

      const anomalies = detectMemoryAnomalies(snapshots, options);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]?.snapshotIdBefore).toBe('snapshot-2');
      expect(anomalies[0]?.snapshotIdAfter).toBe('snapshot-3');
    });
  });

  describe('determinism', () => {
    it('produces the same events in the same order for the same input', () => {
      const snapshots = series([64 * MB, 72 * MB, 80 * MB, 88 * MB]);

      expect(detectMemoryAnomalies(snapshots, options)).toEqual(
        detectMemoryAnomalies(snapshots, options),
      );
    });

    it('sorts by window start, then metric, whatever order detection found them', () => {
      const snapshots = [
        snapshotFixture({
          snapshotId: 'a',
          capturedAt: hoursIn(0),
          usedMemoryBytes: 64 * MB,
          keyCount: 10_000,
        }),
        snapshotFixture({
          snapshotId: 'b',
          capturedAt: hoursIn(1),
          usedMemoryBytes: 192 * MB,
          keyCount: 40_000,
          memory: { evictedKeys: 100 },
        }),
      ];

      const anomalies = detectMemoryAnomalies(snapshots, options);
      const metrics = anomalies.map((anomaly) => anomaly.metric);

      expect(metrics.length).toBeGreaterThan(1);
      expect([...metrics].sort((left, right) => left.localeCompare(right))).toEqual(metrics);
    });

    it('gives every event a distinct, reproducible id', () => {
      const snapshots = series([64 * MB, 192 * MB, 400 * MB]);
      const first = detectMemoryAnomalies(snapshots, options).map((a) => a.eventId);
      const second = detectMemoryAnomalies(snapshots, options).map((a) => a.eventId);

      expect(first).toEqual(second);
      expect(new Set(first).size).toBe(first.length);
    });
  });

  it('reports used_memory when the dataset counter is the samplers substitute', () => {
    const snapshots = [64 * MB, 192 * MB].map((bytes, index) =>
      snapshotFixture({
        snapshotId: `snapshot-${index + 1}`,
        capturedAt: hoursIn(index),
        usedMemoryBytes: bytes,
        memory: { usedMemoryDatasetBytes: bytes },
      }),
    );

    expect(detectMemoryAnomalies(snapshots, options)[0]?.metric).toBe('used_memory');
  });
});
