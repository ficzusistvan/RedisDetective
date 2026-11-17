import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DIAGNOSIS_REPORT_TYPE,
  JSON_REPORT_SCHEMA_VERSION,
  createFileSnapshotStore,
  renderJsonDiagnosis,
  renderJsonReport,
  runDiagnosis as runEngineDiagnosis,
  runLibraryHealthCheck,
  saveLibrarySnapshot,
} from '@redis-detective/cli';
import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';
import {
  GitHubRepositoryRefError,
  loadSnapshots,
  runDiagnosis,
  runHealthCheck,
  saveSnapshot,
} from 'redis-detective';

import { leakingSnapshots } from './helpers/leaking-snapshots.js';

function fakeConnection(client: FakeRedisCommandClient) {
  return async () => ({
    client,
    close: async () => undefined,
  });
}

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'redis-detective-api-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('programmatic API (consumer import from redis-detective)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the functions a consumer would import', () => {
    expect(typeof runHealthCheck).toBe('function');
    expect(typeof saveSnapshot).toBe('function');
    expect(typeof loadSnapshots).toBe('function');
    expect(typeof runDiagnosis).toBe('function');
  });

  it('loads snapshots and diagnoses growth from a directory with no Redis connection', async () => {
    await withTempDir(async (directory) => {
      const store = createFileSnapshotStore(directory);
      for (const snapshot of leakingSnapshots()) {
        await store.save(snapshot);
      }

      const stdout = vi.spyOn(process.stdout, 'write');
      const previousKey = process.env['LLM_API_KEY'];
      process.env['LLM_API_KEY'] = 'sk-should-not-be-read';

      try {
        const loaded = await loadSnapshots(directory);
        expect(loaded).toHaveLength(4);
        expect(loaded[0]?.snapshot.snapshotId).toBe('snapshot-1');

        const report = await runDiagnosis({
          directory,
          generatedAt: '2026-08-25T14:00:00.000Z',
        });

        expect(report.schemaVersion).toBe(1);
        expect(report.reportType).toBe(DIAGNOSIS_REPORT_TYPE);
        expect(report.target).toBeNull();
        expect(report.storeLocation).toBe(directory);
        expect(report.savedLocation).toBeNull();
        expect(report.explanation.likelyCause?.pattern).toBe('cart:items:*');
        expect(report.explanation.model).toBeNull();
        expect(report.graph.attributions.map((item) => item.pattern)).toContain('cart:items:*');

        const engineReport = await runEngineDiagnosis({
          store: createFileSnapshotStore(directory),
          generatedAt: '2026-08-25T14:00:00.000Z',
          target: null,
          sampleSize: null,
          timeoutMs: null,
          memorySamples: null,
          databases: null,
          redactKeys: false,
        });
        expect(report).toEqual(JSON.parse(renderJsonDiagnosis(engineReport)));
      } finally {
        if (previousKey === undefined) {
          delete process.env['LLM_API_KEY'];
        } else {
          process.env['LLM_API_KEY'] = previousKey;
        }
      }

      expect(stdout).not.toHaveBeenCalled();
    });
  });

  it('treats a missing snapshot directory as empty rather than failing', async () => {
    await withTempDir(async (directory) => {
      const loaded = await loadSnapshots(join(directory, 'does-not-exist'));
      expect(loaded).toEqual([]);

      const report = await runDiagnosis({
        directory: join(directory, 'does-not-exist'),
        generatedAt: '2026-08-25T14:00:00.000Z',
      });
      expect(report.snapshots).toEqual([]);
      expect(report.graph.gaps.map((gap) => gap.kind)).toContain('insufficient-snapshots');
    });
  });

  it('records github-unavailable when a repository is named without a token', async () => {
    await withTempDir(async (directory) => {
      const store = createFileSnapshotStore(directory);
      for (const snapshot of leakingSnapshots()) {
        await store.save(snapshot);
      }

      const report = await runDiagnosis({
        directory,
        generatedAt: '2026-08-25T14:00:00.000Z',
        repository: 'acme/checkout',
      });

      expect(report.repository).toBe('acme/checkout');
      expect(report.commitCandidates).toEqual([]);
      expect(report.graph.gaps.map((gap) => gap.kind)).toContain('github-unavailable');
      expect(report.explanation.likelyCause?.pattern).toBe('cart:items:*');
    });
  });

  it('rejects a malformed repository the same way the CLI does', async () => {
    await withTempDir(async (directory) => {
      await expect(runDiagnosis({ directory, repository: 'not-a-repo' })).rejects.toBeInstanceOf(
        GitHubRepositoryRefError,
      );
    });
  });
});

describe('programmatic API (test Redis)', () => {
  it('returns the same health-check object as CLI --json', async () => {
    const client = new FakeRedisCommandClient({
      databases: {
        0: {
          ...fakeKeys('cart:items:', 200, { bytes: 4_096 }),
          ...fakeKeys('session:', 200, { bytes: 128, ttlMs: 3_600_000 }),
        },
      },
    });

    const report = await runLibraryHealthCheck(
      {
        url: 'redis://redis.example.com:6379',
        generatedAt: '2026-08-25T10:00:00.000Z',
      },
      { connect: fakeConnection(client) },
    );

    expect(report.schemaVersion).toBe(JSON_REPORT_SCHEMA_VERSION);
    expect(report.target).toBe('redis://redis.example.com:6379');
    expect(report.findings.map((finding) => finding.kind)).toContain('no-ttl-coverage');
    expect(`${JSON.stringify(report, null, 2)}\n`).toBe(
      renderJsonReport({
        generatedAt: report.generatedAt,
        target: report.target,
        snapshot: report.snapshot,
        findings: report.findings,
        caveats: report.caveats,
      }),
    );
  });

  it('forwards sampling caps, database selection, and key redaction', async () => {
    const client = new FakeRedisCommandClient({
      databases: {
        0: fakeKeys('user:', 80, { ttlMs: 60_000 }),
        1: fakeKeys('session:', 40, { ttlMs: 60_000 }),
      },
    });

    const report = await runLibraryHealthCheck(
      {
        url: 'redis://:secret@redis.example.com:6379/0',
        generatedAt: '2026-08-25T10:00:00.000Z',
        sampleSize: 50,
        timeoutMs: 5_000,
        memorySamples: 2,
        databases: [0, 1],
        redactKeys: true,
      },
      { connect: fakeConnection(client) },
    );

    expect(report.target).toBe('redis://:***@redis.example.com:6379/0');
    expect(report.snapshot.sampling.observedSampleSize).toBeLessThanOrEqual(50);
    expect(client.issuedCommands.some((command) => command.includes('SAMPLES 2'))).toBe(true);
    expect(client.issuedCommands).toContain('SELECT 1');
    expect(
      report.snapshot.patterns.every((pattern) => pattern.exampleKeys[0] === '<redacted>'),
    ).toBe(true);
  });

  it('saves a snapshot to a directory and loads it back', async () => {
    await withTempDir(async (directory) => {
      const client = new FakeRedisCommandClient({
        databases: { 0: fakeKeys('session:', 30, { ttlMs: 3_600_000 }) },
      });

      const saved = await saveLibrarySnapshot(
        { url: 'redis://localhost:6379', directory, redactKeys: true },
        { connect: fakeConnection(client) },
      );

      expect(saved.location.endsWith('.snapshot.json')).toBe(true);
      expect(saved.snapshot.patterns[0]?.exampleKeys).toEqual(['<redacted>']);

      const loaded = await loadSnapshots(directory);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.location).toBe(saved.location);
      expect(loaded[0]?.snapshot.snapshotId).toBe(saved.snapshot.snapshotId);
    });
  });
});
