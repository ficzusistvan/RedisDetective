import { describe, expect, it } from 'vitest';

import { emptyCiGateThresholds, evaluateCiGate, hasCiGateThresholds } from '@redis-detective/cli';
import type { CiGateThresholds } from '@redis-detective/cli';

import { leakingSnapshots } from './helpers/leaking-snapshots.js';
import { patternFixture, snapshotFixture } from './helpers/snapshot-builder.js';

const MB = 1_024 * 1_024;

const ttlDrop: CiGateThresholds = {
  ...emptyCiGateThresholds(),
  ttlDropPoints: 20,
};

const growthPair: CiGateThresholds = {
  ...emptyCiGateThresholds(),
  growthPercent: 25,
  growthBytes: 10 * MB,
};

describe('hasCiGateThresholds', () => {
  it('is false when every rule is off', () => {
    expect(hasCiGateThresholds(emptyCiGateThresholds())).toBe(false);
  });

  it('is true when any rule is armed', () => {
    expect(hasCiGateThresholds({ ...emptyCiGateThresholds(), ttlDropPoints: 20 })).toBe(true);
    expect(hasCiGateThresholds({ ...emptyCiGateThresholds(), newUntimedPatterns: true })).toBe(
      true,
    );
  });
});

describe('evaluateCiGate', () => {
  it('skips when there are fewer than two snapshots, instead of inventing a crossing', () => {
    const empty = evaluateCiGate({
      snapshots: [],
      thresholds: ttlDrop,
      warnOnly: false,
    });
    expect(empty.outcome).toBe('skipped');
    expect(empty.findings).toEqual([]);

    const one = evaluateCiGate({
      snapshots: [snapshotFixture()],
      thresholds: ttlDrop,
      warnOnly: false,
    });
    expect(one.outcome).toBe('skipped');
    expect(one.notes.join(' ')).toMatch(/two snapshots/i);
  });

  it('names the leaking pattern when TTL coverage collapses', () => {
    const result = evaluateCiGate({
      snapshots: leakingSnapshots(),
      thresholds: ttlDrop,
      warnOnly: false,
    });

    expect(result.outcome).toBe('fail');
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'ttl-coverage-drop',
        pattern: 'cart:items:*',
        ttlCoverageBefore: 1,
        ttlCoverageAfter: 0,
        dropPoints: 100,
        thresholdPoints: 20,
      }),
    ]);
  });

  it('becomes a warning under --warn-only', () => {
    const result = evaluateCiGate({
      snapshots: leakingSnapshots(),
      thresholds: ttlDrop,
      warnOnly: true,
    });

    expect(result.outcome).toBe('warn');
    expect(result.findings).toHaveLength(1);
  });

  it('passes when no rule is armed, even if the series is a leak', () => {
    const result = evaluateCiGate({
      snapshots: leakingSnapshots(),
      thresholds: emptyCiGateThresholds(),
      warnOnly: false,
    });

    expect(result.outcome).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('trips growth only when both percent and bytes are exceeded, if both are set', () => {
    const both = evaluateCiGate({
      snapshots: leakingSnapshots(),
      thresholds: growthPair,
      warnOnly: false,
    });
    expect(both.findings.some((finding) => finding.kind === 'pattern-growth')).toBe(true);

    const highBytes = evaluateCiGate({
      snapshots: leakingSnapshots(),
      thresholds: { ...growthPair, growthBytes: 100 * MB },
      warnOnly: false,
    });
    expect(highBytes.findings.some((finding) => finding.kind === 'pattern-growth')).toBe(false);
  });

  it('trips growth on a single threshold when only one is set', () => {
    const percentOnly = evaluateCiGate({
      snapshots: leakingSnapshots(),
      thresholds: { ...emptyCiGateThresholds(), growthPercent: 10 },
      warnOnly: false,
    });
    expect(percentOnly.findings).toEqual([
      expect.objectContaining({
        kind: 'pattern-growth',
        pattern: 'cart:items:*',
        growthPercentThreshold: 10,
        growthBytesThreshold: null,
      }),
    ]);
  });

  it('does not treat a pattern missing from the baseline as zero-byte growth', () => {
    const result = evaluateCiGate({
      snapshots: [
        snapshotFixture({
          snapshotId: 'before',
          capturedAt: '2026-08-25T10:00:00.000Z',
          patterns: [
            patternFixture({
              pattern: 'session:*',
              sampledKeyCount: 80,
              estimatedBytes: 10 * MB,
              keysWithTtl: 80,
              keysWithoutTtl: 0,
            }),
          ],
        }),
        snapshotFixture({
          snapshotId: 'after',
          capturedAt: '2026-08-25T11:00:00.000Z',
          patterns: [
            patternFixture({
              pattern: 'session:*',
              sampledKeyCount: 80,
              estimatedBytes: 10 * MB,
              keysWithTtl: 80,
              keysWithoutTtl: 0,
            }),
            patternFixture({
              pattern: 'cart:items:*',
              sampledKeyCount: 80,
              estimatedBytes: 40 * MB,
              keysWithTtl: 80,
              keysWithoutTtl: 0,
            }),
          ],
        }),
      ],
      thresholds: { ...emptyCiGateThresholds(), growthPercent: 1, growthBytes: 1 },
      warnOnly: false,
    });

    expect(result.findings.some((finding) => finding.kind === 'pattern-growth')).toBe(false);
  });

  it('flags a new pattern that arrives with no TTL', () => {
    const result = evaluateCiGate({
      snapshots: [
        snapshotFixture({
          snapshotId: 'before',
          capturedAt: '2026-08-25T10:00:00.000Z',
          patterns: [
            patternFixture({
              pattern: 'session:*',
              sampledKeyCount: 80,
              keysWithTtl: 80,
              keysWithoutTtl: 0,
            }),
          ],
        }),
        snapshotFixture({
          snapshotId: 'after',
          capturedAt: '2026-08-25T11:00:00.000Z',
          patterns: [
            patternFixture({
              pattern: 'session:*',
              sampledKeyCount: 80,
              keysWithTtl: 80,
              keysWithoutTtl: 0,
            }),
            patternFixture({
              pattern: 'lock:*',
              sampledKeyCount: 40,
              estimatedBytes: 2 * MB,
              estimatedKeyCount: 400,
              keysWithTtl: 0,
              keysWithoutTtl: 40,
            }),
          ],
        }),
      ],
      thresholds: { ...emptyCiGateThresholds(), newUntimedPatterns: true },
      warnOnly: false,
    });

    expect(result.outcome).toBe('fail');
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'new-untimed-pattern',
        pattern: 'lock:*',
        ttlCoverageAfter: 0,
      }),
    ]);
  });

  it('does not flag a new pattern that arrives with a TTL', () => {
    const result = evaluateCiGate({
      snapshots: [
        snapshotFixture({
          snapshotId: 'before',
          capturedAt: '2026-08-25T10:00:00.000Z',
          patterns: [patternFixture({ sampledKeyCount: 80, keysWithTtl: 80, keysWithoutTtl: 0 })],
        }),
        snapshotFixture({
          snapshotId: 'after',
          capturedAt: '2026-08-25T11:00:00.000Z',
          patterns: [
            patternFixture({ sampledKeyCount: 80, keysWithTtl: 80, keysWithoutTtl: 0 }),
            patternFixture({
              pattern: 'cache:page:*',
              sampledKeyCount: 40,
              keysWithTtl: 40,
              keysWithoutTtl: 0,
            }),
          ],
        }),
      ],
      thresholds: { ...emptyCiGateThresholds(), newUntimedPatterns: true },
      warnOnly: false,
    });

    expect(result.outcome).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('ignores a thin sample instead of treating coverage swing as drift', () => {
    const result = evaluateCiGate({
      snapshots: [
        snapshotFixture({
          snapshotId: 'before',
          capturedAt: '2026-08-25T10:00:00.000Z',
          patterns: [
            patternFixture({
              pattern: 'rare:*',
              sampledKeyCount: 5,
              keysWithTtl: 5,
              keysWithoutTtl: 0,
            }),
          ],
        }),
        snapshotFixture({
          snapshotId: 'after',
          capturedAt: '2026-08-25T11:00:00.000Z',
          patterns: [
            patternFixture({
              pattern: 'rare:*',
              sampledKeyCount: 5,
              keysWithTtl: 0,
              keysWithoutTtl: 5,
            }),
          ],
        }),
      ],
      thresholds: ttlDrop,
      warnOnly: false,
    });

    expect(result.outcome).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('does not apply the growth rule when MEMORY USAGE was unavailable', () => {
    const result = evaluateCiGate({
      snapshots: [
        snapshotFixture({
          snapshotId: 'before',
          capturedAt: '2026-08-25T10:00:00.000Z',
          patterns: [
            patternFixture({
              sampledKeyCount: 80,
              estimatedBytes: 10 * MB,
              bytesMeasured: false,
              keysWithTtl: 80,
              keysWithoutTtl: 0,
            }),
          ],
        }),
        snapshotFixture({
          snapshotId: 'after',
          capturedAt: '2026-08-25T11:00:00.000Z',
          patterns: [
            patternFixture({
              sampledKeyCount: 80,
              estimatedBytes: 80 * MB,
              bytesMeasured: false,
              keysWithTtl: 80,
              keysWithoutTtl: 0,
            }),
          ],
        }),
      ],
      thresholds: growthPair,
      warnOnly: false,
    });

    expect(result.findings).toEqual([]);
    expect(result.notes.join(' ')).toMatch(/MEMORY USAGE/i);
  });

  it('notes cluster mode without failing on it', () => {
    const result = evaluateCiGate({
      snapshots: [
        snapshotFixture({
          snapshotId: 'before',
          capturedAt: '2026-08-25T10:00:00.000Z',
          instance: {
            redisVersion: '7.2.4',
            mode: 'cluster',
            role: 'master',
            maxmemoryBytes: null,
            maxmemoryPolicy: 'noeviction',
            uptimeSeconds: 100,
          },
        }),
        snapshotFixture({
          snapshotId: 'after',
          capturedAt: '2026-08-25T11:00:00.000Z',
          instance: {
            redisVersion: '7.2.4',
            mode: 'cluster',
            role: 'master',
            maxmemoryBytes: null,
            maxmemoryPolicy: 'noeviction',
            uptimeSeconds: 200,
          },
        }),
      ],
      thresholds: ttlDrop,
      warnOnly: false,
    });

    expect(result.outcome).toBe('pass');
    expect(result.notes.join(' ')).toMatch(/cluster/i);
  });

  it('passes a flat healthy series', () => {
    const result = evaluateCiGate({
      snapshots: [
        snapshotFixture({
          snapshotId: 'a',
          capturedAt: '2026-08-25T10:00:00.000Z',
          patterns: [patternFixture({ sampledKeyCount: 80, keysWithTtl: 80, keysWithoutTtl: 0 })],
        }),
        snapshotFixture({
          snapshotId: 'b',
          capturedAt: '2026-08-25T11:00:00.000Z',
          patterns: [patternFixture({ sampledKeyCount: 80, keysWithTtl: 80, keysWithoutTtl: 0 })],
        }),
      ],
      thresholds: { ...growthPair, ttlDropPoints: 20, newUntimedPatterns: true },
      warnOnly: false,
    });

    expect(result.outcome).toBe('pass');
    expect(result.findings).toEqual([]);
  });
});
