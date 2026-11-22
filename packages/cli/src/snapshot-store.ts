import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SNAPSHOT_FILE_SCHEMA_VERSION,
  StoredSnapshotError,
  parseStoredSnapshot,
  serializeSnapshot,
  snapshotFileName,
} from '@redis-detective/core';
import type { RedisSnapshot } from '@redis-detective/core';

export { snapshotFileName } from '@redis-detective/core';

export interface StoredSnapshot {
  /** Where this came from, so an error or a report can point at it. */
  readonly location: string;
  readonly snapshot: RedisSnapshot;
}

/**
 * Where snapshots live between runs.
 *
 * An interface rather than direct `fs` calls, so `runDiagnosis` and `main` can be tested against an
 * in-memory store. Nothing else in the CLI is allowed to know that snapshots are files.
 */
export interface SnapshotStore {
  /** Human-readable location, for the report header. */
  readonly describe: string;
  /** Every stored snapshot, oldest first. Throws if any file cannot be read as a snapshot. */
  list(): Promise<readonly StoredSnapshot[]>;
  /** Persists one snapshot and returns where it was written. */
  save(snapshot: RedisSnapshot): Promise<string>;
}

const FILE_SUFFIX = '.snapshot.json';

/**
 * A snapshot store backed by a directory of JSON files.
 *
 * Plain files on purpose. Phase 1 has no server and no database, and a directory the user can
 * inspect, diff, commit and delete is the least surprising place for data they were asked to keep.
 * It also means a snapshot taken on a laptop can be analysed on another machine with no setup.
 */
export function createFileSnapshotStore(directory: string): SnapshotStore {
  return {
    describe: directory,

    async list(): Promise<readonly StoredSnapshot[]> {
      let names: readonly string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if (isMissingDirectory(error)) {
          // Not an error: the first run has nothing stored yet, and `runDiagnosis` reports the
          // resulting shortage of snapshots as an evidence gap rather than as a failure.
          return [];
        }
        throw error;
      }

      const stored: StoredSnapshot[] = [];
      // Sorted by name, which the leading timestamp makes chronological. `buildEvidenceGraph` sorts
      // properly by `capturedAt` anyway; this only keeps error messages predictable.
      for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
        if (!name.endsWith(FILE_SUFFIX)) {
          continue;
        }

        const location = join(directory, name);
        stored.push({
          location,
          snapshot: parseStoredSnapshot(await readJson(location), location),
        });
      }

      return stored;
    },

    async save(snapshot: RedisSnapshot): Promise<string> {
      await mkdir(directory, { recursive: true });
      const location = join(directory, snapshotFileName(snapshot));
      const contents = {
        schemaVersion: SNAPSHOT_FILE_SCHEMA_VERSION,
        snapshot: serializeSnapshot(snapshot),
      };
      await writeFile(location, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
      return location;
    },
  };
}

/**
 * In-memory store for tests. Same contract as the file store, no disk, so `runDiagnosis` and
 * `main` can be exercised without a temporary directory.
 */
export function createMemorySnapshotStore(
  initial: readonly RedisSnapshot[] = [],
  describe = 'memory',
): SnapshotStore {
  const stored: StoredSnapshot[] = initial.map((snapshot) => ({
    location: `memory:${snapshotFileName(snapshot)}`,
    snapshot,
  }));

  return {
    describe,

    list(): Promise<readonly StoredSnapshot[]> {
      return Promise.resolve(
        [...stored].sort(
          (left, right) =>
            left.snapshot.capturedAt.localeCompare(right.snapshot.capturedAt) ||
            left.snapshot.snapshotId.localeCompare(right.snapshot.snapshotId),
        ),
      );
    },

    save(snapshot: RedisSnapshot): Promise<string> {
      const location = `memory:${snapshotFileName(snapshot)}`;
      const entry: StoredSnapshot = { location, snapshot };
      const existing = stored.findIndex((item) => item.location === location);
      if (existing === -1) {
        stored.push(entry);
      } else {
        stored[existing] = entry;
      }
      return Promise.resolve(location);
    },
  };
}

function isMissingDirectory(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'ENOENT';
}

async function readJson(location: string): Promise<unknown> {
  const raw = await readFile(location, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new StoredSnapshotError(
      `${location} is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}.`,
    );
  }
}
