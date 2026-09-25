import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  StoredSnapshotError,
  createFileSnapshotStore,
  createMemorySnapshotStore,
  snapshotFileName,
} from '@redis-detective/cli';

import { snapshotFixture } from './helpers/snapshot-builder.js';

describe('snapshotFileName', () => {
  it('leads with the timestamp and strips characters that are illegal on Windows', () => {
    const name = snapshotFileName(
      snapshotFixture({ snapshotId: 'snap:1', capturedAt: '2026-08-25T10:00:00.000Z' }),
    );

    expect(name).toBe('2026-08-25T10-00-00-000Z--snap-1.snapshot.json');
    expect(name).not.toContain(':');
  });
});

describe('createMemorySnapshotStore', () => {
  it('lists oldest first and round-trips a save', async () => {
    const newer = snapshotFixture({ snapshotId: 'b', capturedAt: '2026-08-25T12:00:00.000Z' });
    const older = snapshotFixture({ snapshotId: 'a', capturedAt: '2026-08-25T10:00:00.000Z' });
    const store = createMemorySnapshotStore([newer, older], './snaps');

    expect(store.describe).toBe('./snaps');
    expect((await store.list()).map((entry) => entry.snapshot.snapshotId)).toEqual(['a', 'b']);

    const extra = snapshotFixture({ snapshotId: 'c', capturedAt: '2026-08-25T13:00:00.000Z' });
    const location = await store.save(extra);
    expect(location).toContain('c');
    expect((await store.list()).map((entry) => entry.snapshot.snapshotId)).toEqual(['a', 'b', 'c']);
  });
});

describe('createFileSnapshotStore', () => {
  async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'redis-detective-snaps-'));
    try {
      await run(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('treats a missing directory as empty, not as a failure', async () => {
    await withTempDir(async (directory) => {
      const store = createFileSnapshotStore(join(directory, 'does-not-exist'));
      expect(await store.list()).toEqual([]);
    });
  });

  it('creates the directory, writes a snapshot, and reads it back', async () => {
    await withTempDir(async (directory) => {
      const store = createFileSnapshotStore(directory);
      const snapshot = snapshotFixture({ snapshotId: 'round-trip' });
      const location = await store.save(snapshot);

      expect(location).toContain(directory);
      expect(location.endsWith('.snapshot.json')).toBe(true);

      const listed = await store.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.snapshot.snapshotId).toBe('round-trip');
    });
  });

  it('ignores files that are not snapshots', async () => {
    await withTempDir(async (directory) => {
      await writeFile(join(directory, 'README.md'), 'not a snapshot\n', 'utf8');
      const store = createFileSnapshotStore(directory);
      await store.save(snapshotFixture());

      expect(await store.list()).toHaveLength(1);
    });
  });

  it('names the corrupt file when JSON is unreadable', async () => {
    await withTempDir(async (directory) => {
      const location = join(directory, 'broken.snapshot.json');
      await writeFile(location, '{not json', 'utf8');
      const store = createFileSnapshotStore(directory);

      await expect(store.list()).rejects.toThrow(StoredSnapshotError);
      await expect(store.list()).rejects.toThrow(/broken.snapshot.json/);
    });
  });
});
