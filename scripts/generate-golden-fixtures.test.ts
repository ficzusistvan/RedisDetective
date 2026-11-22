/**
 * Records golden diagnosis outputs from the *current* CLI diagnosis path.
 *
 *   pnpm exec vitest run --config vitest.scripts.config.ts
 *
 * Store locations are written as `<fixtures>/<case>/snapshots` so published fixtures never embed a
 * machine path. JSON still uses `<golden>/<case>`. After the core extraction, packages/core tests
 * regenerate JSON with UPDATE_GOLDEN=1; re-run this script when text/markdown must change too.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { KeyPatternStats, RedisSnapshot } from '@redis-detective/core-types';
import {
  SNAPSHOT_FILE_SCHEMA_VERSION,
  createMemorySnapshotStore,
  renderJsonDiagnosis,
  renderMarkdownDiagnosis,
  renderTextDiagnosis,
  runDiagnosis,
  serializeSnapshot,
  snapshotFileName,
} from '@redis-detective/cli';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const goldenRoot = join(repoRoot, 'packages', 'core', 'fixtures', 'golden');
const GENERATED_AT = '2026-08-25T14:00:00.000Z';
const MB = 1_024 * 1_024;

function hoursIn(hours: number): string {
  return new Date(Date.UTC(2026, 7, 25, 10 + hours, 0, 0)).toISOString();
}

function sampling(): RedisSnapshot['sampling'] {
  return {
    strategy: 'randomized-scan',
    requestedSampleSize: 1_000,
    observedSampleSize: 1_000,
    scanPasses: 10,
    effectiveSampleRate: 0.1,
    durationMs: 250,
    truncated: false,
    warnings: [],
  };
}

function pattern(overrides: Partial<KeyPatternStats> = {}): KeyPatternStats {
  return {
    pattern: 'session:*',
    dataType: 'string',
    sampledKeyCount: 100,
    sampledBytes: 512_000,
    estimatedKeyCount: 10_000,
    estimatedBytes: 50 * MB,
    bytesMeasured: true,
    keysWithTtl: 100,
    keysWithoutTtl: 0,
    medianTtlSeconds: 3_600,
    exampleKeys: ['session:aaa111', 'session:bbb222'],
    estimateBasis: 'sampled-extrapolation',
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<RedisSnapshot> & { readonly usedMemoryBytes?: number } = {},
): RedisSnapshot {
  const usedMemoryBytes = overrides.usedMemoryBytes ?? 100 * MB;
  const { usedMemoryBytes: _drop, ...rest } = overrides;
  return {
    snapshotId: 'snapshot-1',
    capturedAt: hoursIn(0),
    instance: {
      redisVersion: '7.2.4',
      mode: 'standalone',
      role: 'master',
      maxmemoryBytes: 2 * 1024 * MB,
      maxmemoryPolicy: 'noeviction',
      uptimeSeconds: 86_400,
    },
    memory: {
      usedMemoryBytes,
      usedMemoryRssBytes: Math.round(usedMemoryBytes * 1.2),
      usedMemoryDatasetBytes: Math.round(usedMemoryBytes * 0.9),
      usedMemoryPeakBytes: usedMemoryBytes,
      memFragmentationRatio: 1.2,
      evictedKeys: 0,
      expiredKeys: 0,
    },
    keyspace: [{ db: 0, keyCount: 100_000, keysWithExpiry: 90_000, averageTtlMs: 3_600_000 }],
    patterns: [pattern()],
    sampling: sampling(),
    ...rest,
  };
}

const CASES: Readonly<Record<string, () => readonly RedisSnapshot[]>> = {
  'flat-no-growth': () => [
    snapshot({
      snapshotId: 'flat-a',
      capturedAt: hoursIn(0),
      usedMemoryBytes: 200 * MB,
      patterns: [pattern({ pattern: 'cache:*', estimatedBytes: 180 * MB })],
    }),
    snapshot({
      snapshotId: 'flat-b',
      capturedAt: hoursIn(1),
      usedMemoryBytes: 200 * MB,
      patterns: [pattern({ pattern: 'cache:*', estimatedBytes: 180 * MB })],
    }),
  ],
  'single-snapshot': () => [
    snapshot({
      snapshotId: 'only',
      capturedAt: hoursIn(0),
      usedMemoryBytes: 128 * MB,
    }),
  ],
  /** ~900 MiB growing ~1.1% (~10 MiB): clears minGrowthBytes but not minGrowthRatio. */
  'below-threshold-growth': () => {
    const before = 900 * MB;
    const after = 910 * MB;
    return [
      snapshot({
        snapshotId: 'large-a',
        capturedAt: hoursIn(0),
        usedMemoryBytes: before,
        patterns: [
          pattern({
            pattern: 'payload:*',
            estimatedBytes: 850 * MB,
            estimatedKeyCount: 100_000,
            sampledKeyCount: 200,
            keysWithTtl: 200,
            keysWithoutTtl: 0,
          }),
        ],
      }),
      snapshot({
        snapshotId: 'large-b',
        capturedAt: hoursIn(1),
        usedMemoryBytes: after,
        patterns: [
          pattern({
            pattern: 'payload:*',
            estimatedBytes: 860 * MB,
            estimatedKeyCount: 101_000,
            sampledKeyCount: 200,
            keysWithTtl: 200,
            keysWithoutTtl: 0,
          }),
        ],
      }),
    ];
  },
  'clear-leak': () => {
    const coverage = [100, 70, 30, 0];
    return [64 * MB, 72 * MB, 80 * MB, 88 * MB].map((usedMemoryBytes, index) => {
      const ttl = coverage[index] ?? 0;
      return snapshot({
        snapshotId: `leak-${index + 1}`,
        capturedAt: hoursIn(index),
        usedMemoryBytes,
        keyspace: [
          {
            db: 0,
            keyCount: 10_000 + index * 20_000,
            keysWithExpiry: 9_000,
            averageTtlMs: 3_600_000,
          },
        ],
        patterns: [
          pattern({
            pattern: 'cart:items:*',
            sampledKeyCount: 100,
            estimatedBytes: (30 + index * 8) * MB,
            estimatedKeyCount: 1_000 + index * 20_000,
            keysWithTtl: ttl,
            keysWithoutTtl: 100 - ttl,
            exampleKeys: ['cart:items:aaa', 'cart:items:bbb'],
          }),
        ],
      });
    });
  },
  'ttl-drift': () => [
    snapshot({
      snapshotId: 'ttl-a',
      capturedAt: hoursIn(0),
      usedMemoryBytes: 64 * MB,
      patterns: [
        pattern({
          pattern: 'session:*',
          sampledKeyCount: 100,
          estimatedBytes: 50 * MB,
          keysWithTtl: 100,
          keysWithoutTtl: 0,
        }),
      ],
    }),
    snapshot({
      snapshotId: 'ttl-b',
      capturedAt: hoursIn(1),
      usedMemoryBytes: 66 * MB,
      patterns: [
        pattern({
          pattern: 'session:*',
          sampledKeyCount: 100,
          estimatedBytes: 52 * MB,
          keysWithTtl: 20,
          keysWithoutTtl: 80,
        }),
      ],
    }),
  ],
  'snapshot-gap': () => [
    snapshot({
      snapshotId: 'gap-a',
      capturedAt: hoursIn(0),
      usedMemoryBytes: 64 * MB,
      patterns: [pattern({ pattern: 'cache:*', estimatedBytes: 50 * MB })],
    }),
    snapshot({
      snapshotId: 'gap-b',
      capturedAt: hoursIn(9),
      usedMemoryBytes: 192 * MB,
      patterns: [pattern({ pattern: 'cache:*', estimatedBytes: 170 * MB })],
    }),
  ],
};

async function writeCase(name: string, snapshots: readonly RedisSnapshot[]): Promise<void> {
  const caseDir = join(goldenRoot, name);
  const snapsDir = join(caseDir, 'snapshots');
  mkdirSync(snapsDir, { recursive: true });

  for (const snap of snapshots) {
    const file = {
      schemaVersion: SNAPSHOT_FILE_SCHEMA_VERSION,
      snapshot: serializeSnapshot(snap),
    };
    writeFileSync(join(snapsDir, snapshotFileName(snap)), `${JSON.stringify(file, null, 2)}\n`);
  }

  // Never embed a real machine path — these fixtures ship in the published core package.
  const storeLocation = `<fixtures>/${name}/snapshots`;
  const report = await runDiagnosis({
    store: createMemorySnapshotStore(snapshots, storeLocation),
    generatedAt: GENERATED_AT,
    target: null,
    sampleSize: null,
    timeoutMs: null,
    memorySamples: null,
    databases: null,
    redactKeys: false,
  });

  const json = JSON.parse(renderJsonDiagnosis(report)) as Record<string, unknown>;
  json['storeLocation'] = `<golden>/${name}`;
  json['target'] = null;
  json['savedLocation'] = null;

  writeFileSync(join(caseDir, 'expected.diagnosis.json'), `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(join(caseDir, 'expected.text.txt'), renderTextDiagnosis(report));
  writeFileSync(join(caseDir, 'expected.markdown.md'), renderMarkdownDiagnosis(report));
}

describe('generate golden fixtures (pre-refactor baseline)', () => {
  it('writes every case from the current diagnosis path', async () => {
    for (const [name, build] of Object.entries(CASES)) {
      await writeCase(name, build());
    }
    expect(Object.keys(CASES).length).toBe(6);
  });
});
