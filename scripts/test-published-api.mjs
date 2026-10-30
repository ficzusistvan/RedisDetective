#!/usr/bin/env node

/**
 * Imports the staged `redis-detective` package the way a consumer would and runs diagnosis
 * against snapshot files. Called from `stage-cli-publish.mjs` after the tarball contents exist.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publishDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'cli',
  'publish',
);

export async function testPublishedApi() {
  const api = await import(pathToFileURL(join(publishDir, 'index.js')).href);
  const directory = await mkdtemp(join(tmpdir(), 'redis-detective-published-api-'));

  try {
    await writeFile(
      join(directory, snapshotName('2026-08-25T10-00-00-000Z', 'a')),
      snapshotFile(0),
    );
    await writeFile(
      join(directory, snapshotName('2026-08-25T11-00-00-000Z', 'b')),
      snapshotFile(1),
    );

    const loaded = await api.loadSnapshots(directory);
    if (loaded.length !== 2) {
      throw new Error(`Expected 2 loaded snapshots, got ${String(loaded.length)}.`);
    }

    const previousKey = process.env['LLM_API_KEY'];
    process.env['LLM_API_KEY'] = 'sk-should-not-be-read';
    let report;
    try {
      report = await api.runDiagnosis({
        directory,
        generatedAt: '2026-08-25T14:00:00.000Z',
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env['LLM_API_KEY'];
      } else {
        process.env['LLM_API_KEY'] = previousKey;
      }
    }

    if (report.reportType !== api.DIAGNOSIS_REPORT_TYPE) {
      throw new Error(
        `Expected reportType ${api.DIAGNOSIS_REPORT_TYPE}, got ${String(report.reportType)}.`,
      );
    }
    if (report.explanation.model !== null) {
      throw new Error(
        'Library diagnosis read LLM_API_KEY; model should be null without an explicit llm option.',
      );
    }
    if (report.explanation.likelyCause?.pattern !== 'cart:items:*') {
      throw new Error(
        `Expected likely cause cart:items:*, got ${String(report.explanation.likelyCause?.pattern)}.`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function snapshotName(stamp, id) {
  return `${stamp}--${id}.snapshot.json`;
}

function snapshotFile(index) {
  const mb = 1_024 * 1_024;
  const used = (64 + index * 24) * mb;
  const ttl = index === 0 ? 100 : 0;
  const snapshot = {
    snapshotId: index === 0 ? 'a' : 'b',
    capturedAt: index === 0 ? '2026-08-25T10:00:00.000Z' : '2026-08-25T11:00:00.000Z',
    instance: {
      redisVersion: '7.2.4',
      mode: 'standalone',
      role: 'master',
      maxmemoryBytes: 1_073_741_824,
      maxmemoryPolicy: 'noeviction',
      uptimeSeconds: 86_400,
    },
    memory: {
      usedMemoryBytes: used,
      usedMemoryRssBytes: Math.round(used * 1.2),
      usedMemoryDatasetBytes: Math.round(used * 0.9),
      usedMemoryPeakBytes: used,
      memFragmentationRatio: 1.2,
      evictedKeys: 0,
      expiredKeys: 0,
    },
    keyspace: [
      {
        db: 0,
        keyCount: 10_000 + index * 20_000,
        keysWithExpiry: 9_000,
        averageTtlMs: 3_600_000,
      },
    ],
    patterns: [
      {
        pattern: 'cart:items:*',
        dataType: 'string',
        sampledKeyCount: 100,
        sampledBytes: 100_000,
        estimatedKeyCount: 1_000 + index * 20_000,
        estimatedBytes: (30 + index * 24) * mb,
        bytesMeasured: true,
        keysWithTtl: ttl,
        keysWithoutTtl: 100 - ttl,
        medianTtlSeconds: ttl === 0 ? null : 3_600,
        exampleKeys: ['cart:items:1'],
        estimateBasis: 'sampled-extrapolation',
      },
    ],
    sampling: {
      strategy: 'randomized-scan',
      requestedSampleSize: 1_000,
      observedSampleSize: 1_000,
      scanPasses: 10,
      effectiveSampleRate: 0.1,
      durationMs: 250,
      truncated: false,
      warnings: [],
    },
  };

  return `${JSON.stringify({ schemaVersion: 1, snapshot }, null, 2)}\n`;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await testPublishedApi();
}
