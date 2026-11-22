import { describe, expect, it } from 'vitest';

import { buildEvidenceGraph } from '@redis-detective/evidence';
import type { EvidenceGapKind, RedisSnapshot } from '@redis-detective/core-types';

import { hoursIn, patternFixture, series, snapshotFixture } from './helpers/snapshot-fixture.js';

const MB = 1_024 * 1_024;
const BUILT_AT = '2026-08-25T20:00:00.000Z';

function build(snapshots: readonly RedisSnapshot[], builtAt = BUILT_AT) {
  return buildEvidenceGraph({ snapshots, builtAt });
}

function gapKinds(snapshots: readonly RedisSnapshot[]): readonly EvidenceGapKind[] {
  return build(snapshots).gaps.map((gap) => gap.kind);
}

/**
 * A TTL leak on `cart:items:*` that grows the instance gradually over four hours.
 *
 * The run rises at every snapshot, so this is the sustained-trend shape rather than a
 * one-interval step — a slow leak is what the product is really for.
 */
function leakingSeries(): readonly RedisSnapshot[] {
  const coverage = [100, 70, 30, 0];

  return [64 * MB, 72 * MB, 80 * MB, 88 * MB].map((usedMemoryBytes, index) =>
    snapshotFixture({
      snapshotId: `snapshot-${index + 1}`,
      capturedAt: hoursIn(index),
      usedMemoryBytes,
      keyCount: 10_000 + index * 20_000,
      patterns: [
        patternFixture({
          pattern: 'cart:items:*',
          estimatedBytes: (30 + index * 8) * MB,
          estimatedKeyCount: 1_000 + index * 20_000,
          keysWithTtl: coverage[index] ?? 0,
          keysWithoutTtl: 100 - (coverage[index] ?? 0),
        }),
      ],
    }),
  );
}

describe('buildEvidenceGraph', () => {
  it('validates options before doing any work', () => {
    expect(() =>
      buildEvidenceGraph({
        snapshots: leakingSeries(),
        builtAt: BUILT_AT,
        options: { minGrowthRatio: 42 },
      }),
    ).toThrow(/minGrowthRatio/);
  });

  describe('never returns an empty graph without saying why', () => {
    it('records insufficient-snapshots for a single snapshot', () => {
      const graph = build([snapshotFixture()]);

      expect(graph.anomalies).toEqual([]);
      expect(graph.attributions).toEqual([]);
      expect(graph.ttlDrift).toEqual([]);
      expect(graph.gaps.map((gap) => gap.kind)).toEqual(['insufficient-snapshots']);
      expect(graph.gaps[0]?.remedy).not.toBeNull();
    });

    it('records insufficient-snapshots for no snapshots at all', () => {
      const graph = build([]);

      expect(graph.gaps.map((gap) => gap.kind)).toEqual(['insufficient-snapshots']);
      expect(graph.snapshotIds).toEqual([]);
      expect(graph.window).toEqual({ from: BUILT_AT, to: BUILT_AT });
    });

    it('records memory-not-comparable for a resident zero instead of claiming no growth', () => {
      const graph = build([
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), usedMemoryBytes: 0 }),
        snapshotFixture({ snapshotId: 'b', capturedAt: hoursIn(1), usedMemoryBytes: 0 }),
      ]);

      expect(graph.anomalies).toEqual([]);
      expect(graph.gaps.map((gap) => gap.kind)).toEqual(['memory-not-comparable']);
      expect(graph.gaps[0]?.detail).toContain('resident memory rather than an empty dataset');
      expect(graph.gaps[0]?.remedy).toBeNull();
    });

    it('records memory-not-comparable when used_memory was not reported', () => {
      const graph = build([
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), usedMemoryBytes: null }),
        snapshotFixture({ snapshotId: 'b', capturedAt: hoursIn(1), usedMemoryBytes: null }),
      ]);

      expect(graph.gaps.map((gap) => gap.kind)).toEqual(['memory-not-comparable']);
      expect(graph.gaps[0]?.detail).toContain('did not report used_memory');
    });

    it('keeps no-growth-detected when the comparable readings are flat around a resident zero', () => {
      const graph = build([
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), usedMemoryBytes: 64 * MB }),
        snapshotFixture({ snapshotId: 'cold', capturedAt: hoursIn(1), usedMemoryBytes: 0 }),
        snapshotFixture({ snapshotId: 'b', capturedAt: hoursIn(2), usedMemoryBytes: 64 * MB }),
      ]);

      expect(graph.anomalies).toEqual([]);
      expect(graph.gaps.map((gap) => gap.kind)).toEqual([
        'memory-not-comparable',
        'no-growth-detected',
      ]);
    });

    it('records no-growth-detected for a flat, well-observed window', () => {
      const graph = build(series([64 * MB, 64 * MB, 64 * MB]));

      expect(graph.anomalies).toEqual([]);
      expect(graph.gaps.map((gap) => gap.kind)).toEqual(['no-growth-detected']);
      // Nothing for the user to do about it, so no remedy is offered.
      expect(graph.gaps[0]?.remedy).toBeNull();
      expect(graph.gaps[0]?.detail).toContain('3 snapshots');
      expect(graph.gaps[0]?.detail).toContain('No memory growth was found');
      expect(graph.gaps[0]?.detail).toContain('2026-08-25 10:00 UTC');
      expect(graph.gaps[0]?.detail).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(graph.gaps[0]?.detail).not.toContain('8388608');
    });

    it('always has either a finding or a gap', () => {
      for (const snapshots of [
        [],
        [snapshotFixture()],
        series([64 * MB, 64 * MB]),
        series([64 * MB, 192 * MB]),
        leakingSeries(),
      ]) {
        const graph = build(snapshots);
        const findings = graph.anomalies.length + graph.attributions.length + graph.ttlDrift.length;

        expect(findings + graph.gaps.length).toBeGreaterThan(0);
      }
    });
  });

  describe('the leak it exists to find', () => {
    it('names the anomaly, the pattern and the mechanism', () => {
      const graph = build(leakingSeries());

      expect(graph.anomalies.map((anomaly) => anomaly.kind)).toContain('memory-growth');
      expect(graph.attributions.map((attribution) => attribution.pattern)).toContain(
        'cart:items:*',
      );
      expect(graph.attributions.map((attribution) => attribution.mechanism)).toContain(
        'keys-not-expiring',
      );
      expect(graph.ttlDrift.map((event) => event.kind)).toContain('ttl-removed');
    });

    it('cross-references the TTL drift event from the attribution that shares its pattern', () => {
      const graph = build(leakingSeries());
      const attribution = graph.attributions.find(
        (entry) => entry.mechanism === 'keys-not-expiring',
      );
      const drift = graph.ttlDrift.find((event) => event.pattern === attribution?.pattern);

      expect(drift).toBeDefined();
      expect(attribution?.observations.join(' ')).toContain(
        'Corroborated by TTL drift on the same pattern.',
      );
      expect(attribution?.observations.join(' ')).not.toContain(drift?.eventId ?? 'missing');
    });

    it('links every attribution to an anomaly that is present in the graph', () => {
      const graph = build(leakingSeries());
      const anomalyIds = new Set(graph.anomalies.map((anomaly) => anomaly.eventId));

      expect(graph.attributions.length).toBeGreaterThan(0);
      for (const attribution of graph.attributions) {
        expect(anomalyIds.has(attribution.anomalyId)).toBe(true);
      }
    });

    it('does not record unattributed growth when a pattern explains the anomaly', () => {
      expect(gapKinds(leakingSeries())).not.toContain('unattributed-growth');
    });
  });

  describe('gap collection', () => {
    it('records sample-too-small when the sample rate is below the attribution floor', () => {
      const thin = series([64 * MB, 192 * MB]).map((snapshot) => ({
        ...snapshot,
        sampling: { ...snapshot.sampling, effectiveSampleRate: 0.0000001 },
      }));

      const detail = build(thin).gaps.find((gap) => gap.kind === 'sample-too-small')?.detail;

      expect(detail).toContain('2 of 2 snapshots');
    });

    it('records sample-too-small when a safety bound cut sampling short', () => {
      const truncated = series([64 * MB, 192 * MB]).map((snapshot) => ({
        ...snapshot,
        sampling: { ...snapshot.sampling, truncated: true },
      }));

      expect(
        build(truncated).gaps.some(
          (gap) => gap.kind === 'sample-too-small' && gap.detail.includes('cut short'),
        ),
      ).toBe(true);
    });

    it('records snapshot-gap for an interval too long to reason about', () => {
      const snapshots = [
        snapshotFixture({ snapshotId: 'a', capturedAt: hoursIn(0), usedMemoryBytes: 64 * MB }),
        snapshotFixture({ snapshotId: 'b', capturedAt: hoursIn(9), usedMemoryBytes: 192 * MB }),
      ];

      const graph = build(snapshots);

      expect(graph.gaps.map((gap) => gap.kind)).toContain('snapshot-gap');
      expect(graph.gaps.map((gap) => gap.kind)).not.toContain('no-growth-detected');
      // The interval was not analysed, so no anomaly may be claimed from it.
      expect(graph.anomalies).toEqual([]);
      const snapshotGap = graph.gaps.find((gap) => gap.kind === 'snapshot-gap');
      expect(snapshotGap?.detail).toContain('6 h');
      expect(snapshotGap?.detail).toContain('9 h');
      expect(snapshotGap?.detail).not.toMatch(/\d+ms\b/);
      // Growth cleared both thresholds; the gap is why it was not attributed — not "below thresholds".
      expect(snapshotGap?.detail).toMatch(
        /Memory grew .+ \(\+200%\), but a 9 h gap between snapshots prevents attributing it/,
      );
      expect(snapshotGap?.detail).not.toContain('below anomaly thresholds');
    });

    it('records pattern-not-comparable for a pattern missing from a snapshot', () => {
      const snapshots = [
        snapshotFixture({
          snapshotId: 'a',
          capturedAt: hoursIn(0),
          patterns: [patternFixture({ pattern: 'cart:*' })],
        }),
        snapshotFixture({
          snapshotId: 'b',
          capturedAt: hoursIn(1),
          patterns: [patternFixture({ pattern: 'cart:*' }), patternFixture({ pattern: 'new:*' })],
        }),
      ];

      const gap = build(snapshots).gaps.find((entry) => entry.kind === 'pattern-not-comparable');

      expect(gap?.detail).toContain('new:*');
      expect(gap?.detail).not.toContain('cart:*');
    });

    it('records unattributed-growth when no pattern explains a measured rise', () => {
      // Memory tripled but every sampled pattern stayed exactly the same size.
      const snapshots = series([64 * MB, 192 * MB]);

      const graph = build(snapshots);

      expect(graph.anomalies).toHaveLength(1);
      expect(graph.attributions).toEqual([]);
      expect(graph.gaps.map((gap) => gap.kind)).toContain('unattributed-growth');
      expect(graph.gaps.find((gap) => gap.kind === 'unattributed-growth')?.detail).toContain(
        'cause is not established',
      );
    });

    it('does not claim a missing repository, which it has no way to know about', () => {
      expect(gapKinds(leakingSeries())).not.toContain('no-repository-connected');
    });
  });

  describe('determinism', () => {
    it('produces a byte-identical graph for the same snapshots', () => {
      const snapshots = leakingSeries();

      expect(JSON.stringify(build(snapshots))).toBe(JSON.stringify(build(snapshots)));
    });

    it('gives the same graphId whatever order the snapshots arrive in', () => {
      const snapshots = leakingSeries();
      const shuffled = [snapshots[2], snapshots[0], snapshots[3], snapshots[1]].filter(
        (snapshot): snapshot is RedisSnapshot => snapshot !== undefined,
      );

      expect(build(shuffled).graphId).toBe(build(snapshots).graphId);
      expect(build(shuffled).snapshotIds).toEqual(build(snapshots).snapshotIds);
    });

    it('gives the same graphId regardless of when it was built', () => {
      // The id identifies what was analysed, not when, so citations survive a re-run.
      const snapshots = leakingSeries();

      expect(build(snapshots, '2027-01-01T00:00:00.000Z').graphId).toBe(build(snapshots).graphId);
    });

    it('reports the caller-supplied builtAt without reading a clock', () => {
      expect(build(leakingSeries()).builtAt).toBe(BUILT_AT);
    });

    it('sorts gaps into a stable order', () => {
      const snapshots = series([64 * MB, 192 * MB]).map((snapshot) => ({
        ...snapshot,
        sampling: { ...snapshot.sampling, truncated: true, effectiveSampleRate: 0.0000001 },
      }));

      const kinds = build(snapshots).gaps.map((gap) => gap.kind);

      expect([...kinds].sort((left, right) => left.localeCompare(right))).toEqual(kinds);
    });
  });

  it('reports the window spanned by the snapshots, not by the analysis run', () => {
    const graph = build(leakingSeries());

    expect(graph.window).toEqual({ from: hoursIn(0), to: hoursIn(3) });
    expect(graph.snapshotIds).toEqual(['snapshot-1', 'snapshot-2', 'snapshot-3', 'snapshot-4']);
  });

  it('honours overridden thresholds', () => {
    const snapshots = series([64 * MB, 70 * MB]);

    expect(buildEvidenceGraph({ snapshots, builtAt: BUILT_AT }).anomalies).toEqual([]);
    expect(
      buildEvidenceGraph({
        snapshots,
        builtAt: BUILT_AT,
        options: { minGrowthBytes: 1_024, minGrowthRatio: 0.01 },
      }).anomalies,
    ).toHaveLength(1);
  });

  it('names the pattern behind a ~5% rise on a ~909 MiB instance', () => {
    const graph = build(largeInstanceSeries());

    expect(graph.anomalies.map((anomaly) => anomaly.kind)).toEqual(['memory-growth']);
    expect(graph.attributions.map((attribution) => attribution.pattern)).toEqual(['session:*']);
    expect(graph.attributions.map((attribution) => attribution.mechanism)).toContain('more-keys');
    expect(graph.gaps.map((gap) => gap.kind)).not.toContain('no-growth-detected');
    expect(JSON.stringify(graph.gaps)).not.toContain('8388608');
  });

  it('says a rise under 8 MiB or 2% is below the anomaly thresholds and names the contributing pattern', () => {
    const graph = build(belowThresholdSeries());
    const gap = graph.gaps.find((entry) => entry.kind === 'no-growth-detected');

    expect(graph.anomalies).toEqual([]);
    expect(graph.attributions).toEqual([]);
    expect(gap?.detail).toBe(
      'Memory grew 10 MiB (+1%), below anomaly thresholds (8 MiB and 2%). session:* contributed the most estimated growth, 8 MiB, as more keys. Across 3 snapshots from 2026-11-14 03:30 UTC to 2026-11-14 04:32 UTC.',
    );
    expect(gap?.detail).not.toContain('cache:*');
    expect(gap?.detail).not.toContain('8388608');
    expect(gap?.detail).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('says memory fell when stored size shrank', () => {
    const graph = build([
      snapshotFixture({
        snapshotId: 'a',
        capturedAt: '2026-11-14T03:30:00.000Z',
        usedMemoryBytes: 64 * MB,
        memory: { usedMemoryDatasetBytes: 64 * MB },
        patterns: [],
      }),
      snapshotFixture({
        snapshotId: 'b',
        capturedAt: '2026-11-14T04:32:00.000Z',
        usedMemoryBytes: 60 * MB,
        memory: { usedMemoryDatasetBytes: 60 * MB },
        patterns: [],
      }),
    ]);
    const gap = graph.gaps.find((entry) => entry.kind === 'no-growth-detected');

    expect(gap?.detail.startsWith('Memory fell ')).toBe(true);
    expect(gap?.detail).not.toContain('No memory growth was found');
    expect(gap?.detail).toContain('2026-11-14 03:30 UTC');
  });
});

const MIB = MB;

function storedPoint(
  index: number,
  bytes: number,
  capturedAt: string,
  patterns: ReturnType<typeof patternFixture>[],
) {
  return snapshotFixture({
    snapshotId: `snapshot-${index + 1}`,
    capturedAt,
    usedMemoryBytes: bytes,
    memory: { usedMemoryDatasetBytes: bytes },
    keyCount: 100_000,
    patterns,
  });
}

/** ~909 MiB rising ~46.9 MiB / ~5.2% across five snapshots. session:* holds most of the bytes. */
function largeInstanceSeries(): readonly RedisSnapshot[] {
  const start = 909 * MIB;
  const total = Math.round(46.9 * MIB);
  const at = [
    '2026-11-14T03:30:00.000Z',
    '2026-11-14T03:45:00.000Z',
    '2026-11-14T04:00:00.000Z',
    '2026-11-14T04:15:00.000Z',
    '2026-11-14T04:32:00.000Z',
  ];

  return at.map((capturedAt, index) => {
    const progress = index / 4;
    return storedPoint(index, start + Math.round((total * index) / 4), capturedAt, [
      patternFixture({
        pattern: 'session:*',
        estimatedBytes: Math.round((80 + 40 * progress) * MIB),
        estimatedKeyCount: Math.round(8_000 + 8_000 * progress),
        keysWithTtl: 100,
        keysWithoutTtl: 0,
      }),
      patternFixture({
        pattern: 'cache:*',
        estimatedBytes: Math.round((8 + 2 * progress) * MIB),
        estimatedKeyCount: Math.round(1_000 + 100 * progress),
        keysWithTtl: 80,
        keysWithoutTtl: 20,
      }),
    ]);
  });
}

/** +10 MiB / +1% on 1000 MiB. Clears 8 MiB, misses 2%. session:* explains most of it. */
function belowThresholdSeries(): readonly RedisSnapshot[] {
  const at = ['2026-11-14T03:30:00.000Z', '2026-11-14T04:00:00.000Z', '2026-11-14T04:32:00.000Z'];
  const memory = [1000, 1005, 1010];

  return at.map((capturedAt, index) => {
    const progress = index / 2;
    return storedPoint(index, (memory[index] ?? 1000) * MIB, capturedAt, [
      patternFixture({
        pattern: 'session:*',
        estimatedBytes: Math.round((20 + 8 * progress) * MIB),
        estimatedKeyCount: Math.round(1_000 + 3_000 * progress),
        keysWithTtl: 100,
        keysWithoutTtl: 0,
      }),
      patternFixture({
        pattern: 'cache:*',
        estimatedBytes: Math.round((5 + progress) * MIB),
        estimatedKeyCount: Math.round(1_000 + 50 * progress),
        keysWithTtl: 80,
        keysWithoutTtl: 20,
      }),
    ]);
  });
}
