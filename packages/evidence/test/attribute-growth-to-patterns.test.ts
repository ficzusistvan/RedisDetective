import { describe, expect, it } from 'vitest';

import { attributeGrowthToPatterns, resolveEvidenceOptions } from '@redis-detective/evidence';
import type { AnomalyEvent, KeyPatternStats } from '@redis-detective/core-types';

import { hoursIn, patternFixture, snapshotFixture } from './helpers/snapshot-fixture.js';

const options = resolveEvidenceOptions();
const MB = 1_024 * 1_024;

/**
 * A hand-written anomaly rather than one produced by `detectMemoryAnomalies`, so that each
 * attribution rule is exercised against an exact total instead of one detection's arithmetic.
 */
function anomalyFixture(overrides: Partial<AnomalyEvent> = {}): AnomalyEvent {
  return {
    eventId: 'anomaly-under-test',
    kind: 'memory-step-change',
    metric: 'used_memory',
    window: { from: hoursIn(0), to: hoursIn(1) },
    valueBefore: 64 * MB,
    valueAfter: 164 * MB,
    deltaBytes: 100 * MB,
    snapshotIdBefore: 'snapshot-1',
    snapshotIdAfter: 'snapshot-2',
    evidenceStrength: 'moderate',
    observations: [],
    ...overrides,
  };
}

function pair(before: readonly KeyPatternStats[], after: readonly KeyPatternStats[]) {
  return [
    snapshotFixture({ snapshotId: 'snapshot-1', capturedAt: hoursIn(0), patterns: before }),
    snapshotFixture({ snapshotId: 'snapshot-2', capturedAt: hoursIn(1), patterns: after }),
  ];
}

describe('attributeGrowthToPatterns', () => {
  describe('refuses to attribute', () => {
    it('when the anomalys snapshots are not in the list', () => {
      expect(attributeGrowthToPatterns(anomalyFixture(), [], options)).toEqual([]);
    });

    it('when before and after are the same snapshot', () => {
      const snapshots = pair([patternFixture()], [patternFixture()]);

      expect(
        attributeGrowthToPatterns(
          anomalyFixture({ snapshotIdAfter: 'snapshot-1' }),
          snapshots,
          options,
        ),
      ).toEqual([]);
    });

    it('when no pattern appears in both snapshots', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'old:*' })],
        [patternFixture({ pattern: 'new:*', estimatedBytes: 200 * MB })],
      );

      expect(attributeGrowthToPatterns(anomalyFixture(), snapshots, options)).toEqual([]);
    });

    it('to a pattern that only appears in the later snapshot', () => {
      // Absence from a sample means "not visited", not "held nothing". Diffing against an assumed
      // zero would manufacture growth for anything an earlier scan happened to miss.
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB })],
        [
          patternFixture({ pattern: 'cart:*', estimatedBytes: 132 * MB }),
          patternFixture({ pattern: 'surprise:*', estimatedBytes: 500 * MB }),
        ],
      );

      const attributions = attributeGrowthToPatterns(anomalyFixture(), snapshots, options);

      expect(attributions.map((entry) => entry.pattern)).toEqual(['cart:*']);
    });

    it('to a pattern that shrank', () => {
      const snapshots = pair(
        [
          patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB }),
          patternFixture({ pattern: 'shrinking:*', estimatedBytes: 50 * MB }),
        ],
        [
          patternFixture({ pattern: 'cart:*', estimatedBytes: 132 * MB }),
          patternFixture({ pattern: 'shrinking:*', estimatedBytes: 10 * MB }),
        ],
      );

      expect(
        attributeGrowthToPatterns(anomalyFixture(), snapshots, options).map(
          (entry) => entry.pattern,
        ),
      ).toEqual(['cart:*']);
    });

    it('when nothing grew at all', () => {
      const snapshots = pair([patternFixture()], [patternFixture()]);

      expect(
        attributeGrowthToPatterns(anomalyFixture({ deltaBytes: null }), snapshots, options),
      ).toEqual([]);
    });

    it('matching a pattern across data types, which is a migration rather than growth', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'queue:*', dataType: 'list', estimatedBytes: 32 * MB })],
        [patternFixture({ pattern: 'queue:*', dataType: 'hash', estimatedBytes: 132 * MB })],
      );

      expect(attributeGrowthToPatterns(anomalyFixture(), snapshots, options)).toEqual([]);
    });
  });

  describe('share of growth', () => {
    it('measures a single responsible pattern against the anomalys own byte delta', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB })],
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 132 * MB })],
      );

      const attributions = attributeGrowthToPatterns(anomalyFixture(), snapshots, options);

      expect(attributions).toHaveLength(1);
      expect(attributions[0]?.bytesGrowth).toBe(100 * MB);
      expect(attributions[0]?.shareOfAnomalyGrowth).toBeCloseTo(1);
      expect(attributions[0]?.anomalyId).toBe('anomaly-under-test');
    });

    it('drops a pattern below minAttributionShare rather than listing it as a cause', () => {
      const snapshots = pair(
        [
          patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB }),
          patternFixture({ pattern: 'noise:*', estimatedBytes: 1 * MB }),
        ],
        [
          patternFixture({ pattern: 'cart:*', estimatedBytes: 127 * MB }),
          patternFixture({ pattern: 'noise:*', estimatedBytes: 6 * MB }),
        ],
      );

      const attributions = attributeGrowthToPatterns(anomalyFixture(), snapshots, options);

      expect(attributions.map((entry) => entry.pattern)).toEqual(['cart:*']);
    });

    it('never claims to explain more than all of the growth', () => {
      // Extrapolation noise can put a pattern's estimated growth above the measured total.
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB })],
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 900 * MB })],
      );

      const attributions = attributeGrowthToPatterns(anomalyFixture(), snapshots, options);

      expect(attributions[0]?.shareOfAnomalyGrowth).toBe(1);
    });

    it('keeps at most maxAttributionsPerAnomaly, highest share first', () => {
      const before = Array.from({ length: 6 }, (_unused, index) =>
        patternFixture({ pattern: `p${index}:*`, estimatedBytes: 1 * MB }),
      );
      const after = Array.from({ length: 6 }, (_unused, index) =>
        // Descending growth, so the ranking is checkable.
        patternFixture({ pattern: `p${index}:*`, estimatedBytes: (30 - index * 2) * MB }),
      );

      const attributions = attributeGrowthToPatterns(
        anomalyFixture({ deltaBytes: 114 * MB }),
        pair(before, after),
        options,
      );

      expect(attributions).toHaveLength(options.maxAttributionsPerAnomaly);
      expect(attributions.map((entry) => entry.pattern)).toEqual([
        'p0:*',
        'p1:*',
        'p2:*',
        'p3:*',
        'p4:*',
      ]);
    });

    it('falls back to the sum of grown patterns when the anomaly carries no byte delta', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedKeyCount: 1_000 })],
        [patternFixture({ pattern: 'cart:*', estimatedKeyCount: 5_000 })],
      );

      const attributions = attributeGrowthToPatterns(
        anomalyFixture({ kind: 'key-count-growth', metric: 'key_count', deltaBytes: null }),
        snapshots,
        options,
      );

      expect(attributions).toHaveLength(1);
      expect(attributions[0]?.keyCountGrowth).toBe(4_000);
      expect(attributions[0]?.shareOfAnomalyGrowth).toBeCloseTo(1);
    });
  });

  describe('measures shares in keys when MEMORY USAGE was blocked', () => {
    const snapshots = pair(
      [
        patternFixture({
          pattern: 'cart:*',
          bytesMeasured: false,
          estimatedBytes: 0,
          estimatedKeyCount: 1_000,
        }),
      ],
      [
        patternFixture({
          pattern: 'cart:*',
          bytesMeasured: false,
          estimatedBytes: 0,
          estimatedKeyCount: 9_000,
        }),
      ],
    );

    it('still names the responsible pattern instead of dropping every share to zero', () => {
      const attributions = attributeGrowthToPatterns(anomalyFixture(), snapshots, options);

      expect(attributions).toHaveLength(1);
      expect(attributions[0]?.shareOfAnomalyGrowth).toBeCloseTo(1);
      expect(attributions[0]?.keyCountGrowth).toBe(8_000);
    });

    it('says in its observations that the share was measured in keys', () => {
      const observations =
        attributeGrowthToPatterns(anomalyFixture(), snapshots, options)[0]?.observations.join(' ') ??
        '';

      expect(observations).toContain('MEMORY USAGE was unavailable for this pattern');
      expect(observations).toContain('measured in keys because MEMORY USAGE was unavailable');
    });
  });

  it('measures shares in keys when the anomaly itself was measured in keys', () => {
    // Bytes are available here, but a key-count anomaly carries no byte delta, and a pattern can add
    // keys without its estimated bytes moving. Dividing by a zero byte total would drop every cause.
    const snapshots = pair(
      [patternFixture({ pattern: 'cart:*', estimatedKeyCount: 1_000 })],
      [patternFixture({ pattern: 'cart:*', estimatedKeyCount: 5_000 })],
    );

    const attribution = attributeGrowthToPatterns(
      anomalyFixture({ kind: 'key-count-growth', metric: 'key_count', deltaBytes: null }),
      snapshots,
      options,
    )[0];

    expect(attribution?.shareOfAnomalyGrowth).toBeCloseTo(1);
    expect(attribution?.observations.join(' ')).toContain(
      'measured in keys because the anomaly was measured in key_count',
    );
  });

  describe('mechanism classification', () => {
    it('calls it keys-not-expiring when TTL coverage fell, ahead of any other reading', () => {
      const snapshots = pair(
        [
          patternFixture({
            pattern: 'cart:*',
            estimatedBytes: 32 * MB,
            estimatedKeyCount: 1_000,
            keysWithTtl: 100,
            keysWithoutTtl: 0,
          }),
        ],
        [
          patternFixture({
            pattern: 'cart:*',
            estimatedBytes: 132 * MB,
            estimatedKeyCount: 9_000,
            keysWithTtl: 0,
            keysWithoutTtl: 100,
          }),
        ],
      );

      const attribution = attributeGrowthToPatterns(anomalyFixture(), snapshots, options)[0];

      // Key count also quadrupled, which would read as 'more-keys' — the vaguer, less useful label.
      expect(attribution?.mechanism).toBe('keys-not-expiring');
    });

    it('calls it more-keys when the count grew faster than the mean value size', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB, estimatedKeyCount: 1_000 })],
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 132 * MB, estimatedKeyCount: 9_000 })],
      );

      expect(attributeGrowthToPatterns(anomalyFixture(), snapshots, options)[0]?.mechanism).toBe(
        'more-keys',
      );
    });

    it('calls it larger-values when the same keys hold more data', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'blob:*', estimatedBytes: 32 * MB, estimatedKeyCount: 1_000 })],
        [patternFixture({ pattern: 'blob:*', estimatedBytes: 132 * MB, estimatedKeyCount: 1_000 })],
      );

      expect(attributeGrowthToPatterns(anomalyFixture(), snapshots, options)[0]?.mechanism).toBe(
        'larger-values',
      );
    });

    it('says indeterminate when the sample cannot separate the two', () => {
      // Key count and mean value size both doubled, so neither dominates.
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB, estimatedKeyCount: 1_000 })],
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 128 * MB, estimatedKeyCount: 2_000 })],
      );

      expect(
        attributeGrowthToPatterns(
          anomalyFixture({ deltaBytes: 96 * MB }),
          snapshots,
          options,
        )[0]?.mechanism,
      ).toBe('indeterminate');
    });
  });

  describe('evidence strength', () => {
    it('is strong when several snapshots span the window and TTL drift corroborates it', () => {
      const snapshots = [
        snapshotFixture({
          snapshotId: 'snapshot-1',
          capturedAt: hoursIn(0),
          patterns: [
            patternFixture({
              pattern: 'cart:*',
              estimatedBytes: 32 * MB,
              keysWithTtl: 100,
              keysWithoutTtl: 0,
            }),
          ],
        }),
        snapshotFixture({
          snapshotId: 'snapshot-mid',
          capturedAt: hoursIn(1),
          patterns: [patternFixture({ pattern: 'cart:*', estimatedBytes: 80 * MB })],
        }),
        snapshotFixture({
          snapshotId: 'snapshot-2',
          capturedAt: hoursIn(2),
          patterns: [
            patternFixture({
              pattern: 'cart:*',
              estimatedBytes: 132 * MB,
              keysWithTtl: 0,
              keysWithoutTtl: 100,
            }),
          ],
        }),
      ];

      const attribution = attributeGrowthToPatterns(
        anomalyFixture({ kind: 'memory-growth', window: { from: hoursIn(0), to: hoursIn(2) } }),
        snapshots,
        options,
      )[0];

      expect(attribution?.evidenceStrength).toBe('strong');
      expect(attribution?.supportingSnapshotIds).toEqual([
        'snapshot-1',
        'snapshot-mid',
        'snapshot-2',
      ]);
    });

    it('is moderate on two snapshots with nothing corroborating', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB })],
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 132 * MB })],
      );

      expect(
        attributeGrowthToPatterns(anomalyFixture(), snapshots, options)[0]?.evidenceStrength,
      ).toBe('moderate');
    });

    it('is unclear when the sample was too thin to attribute anything', () => {
      const snapshots = pair(
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB })],
        [patternFixture({ pattern: 'cart:*', estimatedBytes: 132 * MB })],
      ).map((snapshot) => ({
        ...snapshot,
        sampling: { ...snapshot.sampling, effectiveSampleRate: 0.00001 },
      }));

      expect(
        attributeGrowthToPatterns(anomalyFixture(), snapshots, options)[0]?.evidenceStrength,
      ).toBe('unclear');
    });
  });

  it('produces a reproducible id per anomaly and pattern', () => {
    const snapshots = pair(
      [patternFixture({ pattern: 'cart:*', estimatedBytes: 32 * MB })],
      [patternFixture({ pattern: 'cart:*', estimatedBytes: 132 * MB })],
    );

    const first = attributeGrowthToPatterns(anomalyFixture(), snapshots, options);
    const second = attributeGrowthToPatterns(anomalyFixture(), snapshots, options);

    expect(first).toEqual(second);
    expect(first[0]?.attributionId).toMatch(/^attribution-/);
  });
});
