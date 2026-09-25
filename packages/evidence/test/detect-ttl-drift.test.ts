import { describe, expect, it } from 'vitest';

import { detectTtlDrift, resolveEvidenceOptions } from '@redis-detective/evidence';
import type { KeyPatternStats } from '@redis-detective/core-types';

import { hoursIn, patternFixture, snapshotFixture } from './helpers/snapshot-fixture.js';

const options = resolveEvidenceOptions();

/** A series in which one pattern's statistics change from snapshot to snapshot. */
function withPatterns(...patternsPerSnapshot: readonly KeyPatternStats[][]) {
  return patternsPerSnapshot.map((patterns, index) =>
    snapshotFixture({
      snapshotId: `snapshot-${index + 1}`,
      capturedAt: hoursIn(index),
      patterns,
    }),
  );
}

describe('detectTtlDrift', () => {
  describe('does nothing to report', () => {
    it('for fewer than two snapshots', () => {
      expect(detectTtlDrift([], options)).toEqual([]);
      expect(detectTtlDrift([snapshotFixture()], options)).toEqual([]);
    });

    it('for a pattern whose TTL coverage is unchanged', () => {
      expect(
        detectTtlDrift(
          withPatterns([patternFixture({ pattern: 'cart:*' })], [patternFixture({ pattern: 'cart:*' })]),
          options,
        ),
      ).toEqual([]);
    });

    it('for a pattern present in only one snapshot', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 100, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'other:*', keysWithTtl: 0, keysWithoutTtl: 100 })],
      );

      expect(detectTtlDrift(snapshots, options)).toEqual([]);
    });

    it('for a drop smaller than minTtlCoverageDrop', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 100, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 95, keysWithoutTtl: 5 })],
      );

      expect(detectTtlDrift(snapshots, options)).toEqual([]);
    });

    it('for a pattern with no keys sampled at all', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 0 })],
      );

      expect(detectTtlDrift(snapshots, options)).toEqual([]);
    });
  });

  describe('sampling-artefact guards', () => {
    it('ignores a total coverage collapse across a handful of sampled keys', () => {
      // Four keys flipping is a sampling accident, not a deploy. Reporting it would send someone
      // hunting through a commit history for a bug that was never there.
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 4, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 4 })],
      );

      expect(detectTtlDrift(snapshots, options)).toEqual([]);
    });

    it('ignores drift when only the later snapshot has enough sampled keys', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 6, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 400 })],
      );

      expect(detectTtlDrift(snapshots, options)).toEqual([]);
    });

    it('reports the same collapse once the sample is thick enough', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 40, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 40 })],
      );

      expect(detectTtlDrift(snapshots, options).map((event) => event.kind)).toEqual(['ttl-removed']);
    });
  });

  describe('ttl-removed', () => {
    const snapshots = withPatterns(
      [patternFixture({ pattern: 'cart:items:*', keysWithTtl: 100, keysWithoutTtl: 0 })],
      [patternFixture({ pattern: 'cart:items:*', keysWithTtl: 0, keysWithoutTtl: 100 })],
    );

    it('is reported when coverage collapses from a material level to nothing', () => {
      const events = detectTtlDrift(snapshots, options);

      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('ttl-removed');
      expect(events[0]?.pattern).toBe('cart:items:*');
      expect(events[0]?.ttlCoverageBefore).toBe(1);
      expect(events[0]?.ttlCoverageAfter).toBe(0);
    });

    it('records the window and the snapshots it compared', () => {
      const event = detectTtlDrift(snapshots, options)[0];

      expect(event?.window).toEqual({ from: hoursIn(0), to: hoursIn(1) });
      expect(event?.snapshotIdBefore).toBe('snapshot-1');
      expect(event?.snapshotIdAfter).toBe('snapshot-2');
    });

    it('names the likely cause in its observations', () => {
      const event = detectTtlDrift(snapshots, options)[0];

      expect(event?.observations.join(' ')).toContain('EX argument');
      expect(event?.observations.join(' ')).toContain('100 sampled keys before');
    });

    it('survives a single straggler still carrying a TTL', () => {
      const straggler = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 500, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 4, keysWithoutTtl: 496 })],
      );

      expect(detectTtlDrift(straggler, options)[0]?.kind).toBe('ttl-removed');
    });

    it('is strong when three snapshots agree and the pattern also grew', () => {
      const growing = withPatterns(
        [
          patternFixture({
            pattern: 'cart:*',
            keysWithTtl: 100,
            keysWithoutTtl: 0,
            estimatedKeyCount: 1_000,
          }),
        ],
        [
          patternFixture({
            pattern: 'cart:*',
            keysWithTtl: 40,
            keysWithoutTtl: 60,
            estimatedKeyCount: 4_000,
          }),
        ],
        [
          patternFixture({
            pattern: 'cart:*',
            keysWithTtl: 0,
            keysWithoutTtl: 100,
            estimatedKeyCount: 9_000,
          }),
        ],
      );

      const event = detectTtlDrift(growing, options)[0];

      expect(event?.kind).toBe('ttl-removed');
      expect(event?.evidenceStrength).toBe('strong');
    });

    it('is only moderate on two snapshots with no growth alongside', () => {
      expect(detectTtlDrift(snapshots, options)[0]?.evidenceStrength).toBe('moderate');
    });

    it('is unclear when the sample was far too thin to attribute anything', () => {
      const thin = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 100, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 100 })],
      ).map((snapshot) => ({
        ...snapshot,
        sampling: { ...snapshot.sampling, effectiveSampleRate: 0.0001 },
      }));

      expect(detectTtlDrift(thin, options)[0]?.evidenceStrength).toBe('unclear');
    });
  });

  describe('ttl-coverage-declining', () => {
    it('is reported when coverage falls materially without reaching zero', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 100, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 50, keysWithoutTtl: 50 })],
      );

      const events = detectTtlDrift(snapshots, options);

      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('ttl-coverage-declining');
      expect(events[0]?.ttlCoverageAfter).toBeCloseTo(0.5);
      expect(events[0]?.observations.join(' ')).toContain('50.0 percentage points');
    });
  });

  describe('never-expiring-growth', () => {
    it('is reported for a pattern that never expired and is still growing', () => {
      const snapshots = withPatterns(
        [
          patternFixture({
            pattern: 'audit:*',
            keysWithTtl: 0,
            keysWithoutTtl: 100,
            estimatedKeyCount: 1_000,
          }),
        ],
        [
          patternFixture({
            pattern: 'audit:*',
            keysWithTtl: 0,
            keysWithoutTtl: 100,
            estimatedKeyCount: 5_000,
          }),
        ],
      );

      const events = detectTtlDrift(snapshots, options);

      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('never-expiring-growth');
      expect(events[0]?.observations.join(' ')).toContain('nothing will reclaim it');
    });

    it('stays quiet for a pattern that never expired and is not growing', () => {
      const snapshots = withPatterns(
        [
          patternFixture({
            pattern: 'config:*',
            keysWithTtl: 0,
            keysWithoutTtl: 100,
            estimatedKeyCount: 1_000,
          }),
        ],
        [
          patternFixture({
            pattern: 'config:*',
            keysWithTtl: 0,
            keysWithoutTtl: 100,
            estimatedKeyCount: 1_020,
          }),
        ],
      );

      expect(detectTtlDrift(snapshots, options)).toEqual([]);
    });
  });

  describe('ttl-lengthened', () => {
    it('is reported when keys still expire but live much longer', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'session:*', medianTtlSeconds: 3_600 })],
        [patternFixture({ pattern: 'session:*', medianTtlSeconds: 86_400 })],
      );

      const events = detectTtlDrift(snapshots, options);

      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('ttl-lengthened');
      expect(events[0]?.medianTtlSecondsBefore).toBe(3_600);
      expect(events[0]?.medianTtlSecondsAfter).toBe(86_400);
    });

    it('stays quiet when a median is unavailable', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'session:*', medianTtlSeconds: null })],
        [patternFixture({ pattern: 'session:*', medianTtlSeconds: 86_400 })],
      );

      expect(detectTtlDrift(snapshots, options)).toEqual([]);
    });

    it('loses to a coverage collapse, which is the more actionable finding', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'session:*', keysWithTtl: 100, medianTtlSeconds: 3_600 })],
        [
          patternFixture({
            pattern: 'session:*',
            keysWithTtl: 0,
            keysWithoutTtl: 100,
            medianTtlSeconds: 86_400,
          }),
        ],
      );

      expect(detectTtlDrift(snapshots, options).map((event) => event.kind)).toEqual(['ttl-removed']);
    });
  });

  describe('determinism and ordering', () => {
    it('sorts by pattern so two runs agree', () => {
      const snapshots = withPatterns(
        [
          patternFixture({ pattern: 'zeta:*', keysWithTtl: 100, keysWithoutTtl: 0 }),
          patternFixture({ pattern: 'alpha:*', keysWithTtl: 100, keysWithoutTtl: 0 }),
        ],
        [
          patternFixture({ pattern: 'zeta:*', keysWithTtl: 0, keysWithoutTtl: 100 }),
          patternFixture({ pattern: 'alpha:*', keysWithTtl: 0, keysWithoutTtl: 100 }),
        ],
      );

      const events = detectTtlDrift(snapshots, options);

      expect(events.map((event) => event.pattern)).toEqual(['alpha:*', 'zeta:*']);
      expect(detectTtlDrift(snapshots, options)).toEqual(events);
    });

    it('sums a pattern split across data types rather than picking one arbitrarily', () => {
      const snapshots = withPatterns(
        [
          patternFixture({
            pattern: 'queue:*',
            dataType: 'string',
            keysWithTtl: 60,
            keysWithoutTtl: 0,
          }),
          patternFixture({ pattern: 'queue:*', dataType: 'list', keysWithTtl: 40, keysWithoutTtl: 0 }),
        ],
        [
          patternFixture({
            pattern: 'queue:*',
            dataType: 'string',
            keysWithTtl: 0,
            keysWithoutTtl: 60,
          }),
          patternFixture({ pattern: 'queue:*', dataType: 'list', keysWithTtl: 0, keysWithoutTtl: 40 }),
        ],
      );

      const events = detectTtlDrift(snapshots, options);

      expect(events).toHaveLength(1);
      expect(events[0]?.observations.join(' ')).toContain('100 sampled keys before');
    });

    it('gives every event a reproducible id', () => {
      const snapshots = withPatterns(
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 100, keysWithoutTtl: 0 })],
        [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 100 })],
      );

      expect(detectTtlDrift(snapshots, options)[0]?.eventId).toBe(
        detectTtlDrift(snapshots, options)[0]?.eventId,
      );
    });
  });

  it('reports drift on a pattern whose bytes were never measured', () => {
    // MEMORY USAGE being blocked must not hide a TTL leak: coverage comes from PTTL, not bytes.
    const snapshots = withPatterns(
      [
        patternFixture({
          pattern: 'cart:*',
          keysWithTtl: 100,
          keysWithoutTtl: 0,
          bytesMeasured: false,
          estimatedBytes: 0,
          estimatedKeyCount: 1_000,
        }),
      ],
      [
        patternFixture({
          pattern: 'cart:*',
          keysWithTtl: 0,
          keysWithoutTtl: 100,
          bytesMeasured: false,
          estimatedBytes: 0,
          estimatedKeyCount: 6_000,
        }),
      ],
    );

    const event = detectTtlDrift(snapshots, options)[0];

    expect(event?.kind).toBe('ttl-removed');
    expect(event?.evidenceStrength).toBe('moderate');
  });
});
