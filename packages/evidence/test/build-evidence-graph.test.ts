import { describe, expect, it } from 'vitest';

import { EVIDENCE_DEFAULTS, buildEvidenceGraph } from '@redis-detective/evidence';
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
 * Each interval rises by well under `stepChangeRatio`, so this is the sustained-trend shape rather
 * than the deploy-shaped jump — a slow leak is what the product is really for.
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

    it('records no-growth-detected for a flat, well-observed window', () => {
      const graph = build(series([64 * MB, 64 * MB, 64 * MB]));

      expect(graph.anomalies).toEqual([]);
      expect(graph.gaps.map((gap) => gap.kind)).toEqual(['no-growth-detected']);
      // Nothing for the user to do about it, so no remedy is offered.
      expect(graph.gaps[0]?.remedy).toBeNull();
      expect(graph.gaps[0]?.detail).toContain('3 snapshots');
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
        const findings =
          graph.anomalies.length + graph.attributions.length + graph.ttlDrift.length;

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
      expect(attribution?.observations.join(' ')).toContain('Corroborated by TTL drift event');
      expect(attribution?.observations.join(' ')).toContain(drift?.eventId ?? 'missing');
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
      // The interval was not analysed, so no anomaly may be claimed from it.
      expect(graph.anomalies).toEqual([]);
      expect(graph.gaps.find((gap) => gap.kind === 'snapshot-gap')?.detail).toContain(
        String(EVIDENCE_DEFAULTS.maxSnapshotGapMs),
      );
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
        options: { minGrowthBytes: 1_024, stepChangeRatio: 0.01 },
      }).anomalies,
    ).toHaveLength(1);
  });
});
