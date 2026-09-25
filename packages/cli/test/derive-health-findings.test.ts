import { describe, expect, it } from 'vitest';

import { deriveHealthFindings } from '@redis-detective/cli';
import type { HealthFindingKind } from '@redis-detective/cli';
import type { RedisSnapshot } from '@redis-detective/core-types';

import { patternFixture, samplingFixture, snapshotFixture } from './helpers/snapshot-builder.js';

function kinds(snapshot: RedisSnapshot): readonly HealthFindingKind[] {
  return deriveHealthFindings(snapshot).map((finding) => finding.kind);
}

describe('deriveHealthFindings', () => {
  it('reports nothing for a healthy instance', () => {
    expect(deriveHealthFindings(snapshotFixture())).toEqual([]);
  });

  it('is pure: the same snapshot always yields the same findings', () => {
    const snapshot = snapshotFixture({ patterns: [patternFixture()] });

    expect(deriveHealthFindings(snapshot)).toEqual(deriveHealthFindings(snapshot));
  });

  describe('evictions', () => {
    it('reports active evictions as data loss in progress', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({
          memory: { ...snapshotFixture().memory, evictedKeys: 4_211 },
        }),
      );

      expect(findings[0]?.kind).toBe('evictions-active');
      expect(findings[0]?.evidenceStrength).toBe('strong');
      expect(findings[0]?.detail).toContain('4,211');
    });
  });

  describe('headroom', () => {
    it('reports low headroom against a configured maxmemory', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({
          memory: { ...snapshotFixture().memory, usedMemoryBytes: 966_367_641 },
        }),
      );

      expect(findings[0]?.kind).toBe('low-headroom');
      expect(findings[0]?.detail).toContain('90.0%');
    });

    it('warns that noeviction fails writes rather than evicting', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({
          memory: { ...snapshotFixture().memory, usedMemoryBytes: 966_367_641 },
        }),
      );

      expect(findings[0]?.recommendedAction).toContain('writes will start failing');
    });

    it('stays quiet when no ceiling is configured, however much memory is used', () => {
      const base = snapshotFixture();
      const snapshot = snapshotFixture({
        instance: { ...base.instance, maxmemoryBytes: null },
        memory: { ...base.memory, usedMemoryBytes: 10_737_418_240 },
      });

      expect(kinds(snapshot)).not.toContain('low-headroom');
    });
  });

  describe('TTL coverage', () => {
    it('reports a large pattern that never expires', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({
          patterns: [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 500 })],
        }),
      );

      expect(findings[0]?.kind).toBe('no-ttl-coverage');
      expect(findings[0]?.title).toBe('cart:* never expires');
      expect(findings[0]?.recommendedAction).toContain('SET without EX');
    });

    // The most useful single signal a one-shot health check can produce.
    it('reports a pattern where only some keys expire', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({
          patterns: [patternFixture({ pattern: 'cart:*', keysWithTtl: 100, keysWithoutTtl: 400 })],
        }),
      );

      expect(findings[0]?.kind).toBe('partial-ttl-coverage');
      expect(findings[0]?.detail).toContain('20.0%');
      expect(findings[0]?.detail).toContain(
        'One write path is setting an expiry and another is not',
      );
    });

    it('stays quiet when coverage is effectively complete', () => {
      const snapshot = snapshotFixture({
        patterns: [patternFixture({ keysWithTtl: 495, keysWithoutTtl: 5 })],
      });

      expect(kinds(snapshot)).not.toContain('partial-ttl-coverage');
    });

    // Plenty of data legitimately never expires; only material patterns are worth flagging.
    it('ignores a small never-expiring pattern', () => {
      const snapshot = snapshotFixture({
        patterns: [
          patternFixture({ pattern: 'session:*', estimatedBytes: 51_200_000 }),
          patternFixture({
            pattern: 'config:*',
            sampledKeyCount: 2,
            estimatedKeyCount: 2,
            estimatedBytes: 512,
            keysWithTtl: 0,
            keysWithoutTtl: 2,
            medianTtlSeconds: null,
          }),
        ],
      });

      expect(kinds(snapshot)).not.toContain('no-ttl-coverage');
    });
  });

  describe('dominant patterns', () => {
    it('names the patterns holding most of the data', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({
          patterns: [
            patternFixture({ pattern: 'cart:*', estimatedBytes: 80_000_000 }),
            patternFixture({ pattern: 'session:*', estimatedBytes: 20_000_000 }),
          ],
        }),
      );

      const dominant = findings.filter((finding) => finding.kind === 'dominant-pattern');
      expect(dominant[0]?.title).toBe('cart:* holds 80.0% of sampled data');
      expect(dominant[0]?.detail).toContain('session:aaa111');
    });

    it('ignores patterns below the share threshold', () => {
      const snapshot = snapshotFixture({
        patterns: [
          patternFixture({ pattern: 'a:*', estimatedBytes: 90_000_000 }),
          patternFixture({ pattern: 'b:*', estimatedBytes: 1_000_000 }),
        ],
      });

      const titles = deriveHealthFindings(snapshot)
        .filter((finding) => finding.kind === 'dominant-pattern')
        .map((finding) => finding.title);

      expect(titles).toHaveLength(1);
      expect(titles[0]).toContain('a:*');
    });

    it('makes no causal claim, since one snapshot cannot support one', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({ patterns: [patternFixture({ estimatedBytes: 80_000_000 })] }),
      );
      const prose = findings.map((finding) => `${finding.title} ${finding.detail}`).join(' ');

      for (const causalWord of ['caused', 'because', 'due to', 'grew', 'growth', 'leak']) {
        expect(prose.toLowerCase()).not.toContain(causalWord);
      }
    });
  });

  describe('fragmentation', () => {
    it('reports high fragmentation on a large instance', () => {
      const base = snapshotFixture();
      const findings = deriveHealthFindings(
        snapshotFixture({
          memory: { ...base.memory, memFragmentationRatio: 1.8, usedMemoryRssBytes: 188_743_680 },
        }),
      );

      expect(
        kinds(snapshotFixture({ memory: { ...base.memory, memFragmentationRatio: 1.8 } })),
      ).toContain('high-fragmentation');
      expect(
        findings.find((finding) => finding.kind === 'high-fragmentation')?.recommendedAction,
      ).toContain('allocator behaviour');
    });

    // The ratio is meaningless on a nearly empty instance.
    it('stays quiet on a small instance', () => {
      const base = snapshotFixture();
      const snapshot = snapshotFixture({
        memory: { ...base.memory, memFragmentationRatio: 3, usedMemoryBytes: 1_048_576 },
      });

      expect(kinds(snapshot)).not.toContain('high-fragmentation');
    });
  });

  // A managed provider that blocks MEMORY USAGE leaves every byte figure at zero. Shares must
  // then come from key counts, or the size thresholds would filter out every finding — including
  // the TTL leak, which needs no byte figures at all.
  describe('when MEMORY USAGE is unavailable', () => {
    const unmeasured = snapshotFixture({
      patterns: [
        patternFixture({
          pattern: 'cart:*',
          sampledBytes: 0,
          estimatedBytes: 0,
          bytesMeasured: false,
          keysWithTtl: 100,
          keysWithoutTtl: 400,
        }),
        patternFixture({
          pattern: 'session:*',
          sampledBytes: 0,
          estimatedBytes: 0,
          bytesMeasured: false,
          estimatedKeyCount: 10_000,
        }),
      ],
    });

    it('still reports the TTL finding', () => {
      expect(kinds(unmeasured)).toContain('partial-ttl-coverage');
    });

    it('reports share by key count and says so', () => {
      const dominant = deriveHealthFindings(unmeasured).filter(
        (finding) => finding.kind === 'dominant-pattern',
      );

      expect(dominant.length).toBeGreaterThan(0);
      expect(dominant[0]?.title).toContain('of sampled keys');
    });

    // "0 B" would read as a measurement of nothing rather than an absence of measurement.
    it('never quotes a size it does not have', () => {
      const prose = deriveHealthFindings(unmeasured)
        .map((finding) => `${finding.title} ${finding.detail}`)
        .join(' ');

      expect(prose).not.toContain('0 B');
      expect(prose).toContain('an unmeasured amount of memory');
    });
  });

  describe('sample quality', () => {
    it('caveats a thin sample', () => {
      const snapshot = snapshotFixture({
        patterns: [patternFixture()],
        sampling: samplingFixture({ effectiveSampleRate: 0.0001 }),
      });

      const thin = deriveHealthFindings(snapshot).find((finding) => finding.kind === 'thin-sample');
      expect(thin?.evidenceStrength).toBe('unclear');
      expect(thin?.detail).toContain('may be missing entirely');
    });

    it('caveats a truncated scan', () => {
      const snapshot = snapshotFixture({
        patterns: [patternFixture()],
        sampling: samplingFixture({ truncated: true, effectiveSampleRate: 0.5 }),
      });

      expect(kinds(snapshot)).toContain('thin-sample');
    });

    it('does not caveat an empty instance, where there is nothing to sample', () => {
      const snapshot = snapshotFixture({
        sampling: samplingFixture({ observedSampleSize: 0, effectiveSampleRate: 0 }),
      });

      expect(kinds(snapshot)).not.toContain('thin-sample');
    });

    it('downgrades pattern findings taken from a truncated scan', () => {
      const findings = deriveHealthFindings(
        snapshotFixture({
          patterns: [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 500 })],
          sampling: samplingFixture({ truncated: true }),
        }),
      );

      expect(findings[0]?.evidenceStrength).toBe('unclear');
    });
  });

  it('orders findings by urgency, with active data loss first', () => {
    const base = snapshotFixture();
    const findings = kinds(
      snapshotFixture({
        memory: {
          ...base.memory,
          evictedKeys: 500,
          usedMemoryBytes: 966_367_641,
          memFragmentationRatio: 1.9,
        },
        patterns: [patternFixture({ pattern: 'cart:*', keysWithTtl: 0, keysWithoutTtl: 500 })],
        sampling: samplingFixture({ effectiveSampleRate: 0.0001 }),
      }),
    );

    expect(findings).toEqual([
      'evictions-active',
      'low-headroom',
      'no-ttl-coverage',
      'dominant-pattern',
      'high-fragmentation',
      'thin-sample',
    ]);
  });
});
