import type { LoadedSnapshot } from './loaded-snapshot.js';
import { serializeSnapshot } from './serialize-snapshot.js';
import { createFileSnapshotStore } from './snapshot-store.js';

export type { LoadedSnapshot } from './loaded-snapshot.js';

/**
 * Reads every `*.snapshot.json` in `directory`, oldest first.
 *
 * A missing directory is an empty list, not an error — the first save has nothing stored yet.
 * Throws `StoredSnapshotError` when a file is present but cannot be parsed.
 */
export async function loadLibrarySnapshots(directory: string): Promise<readonly LoadedSnapshot[]> {
  const stored = await createFileSnapshotStore(directory).list();
  return stored.map((entry) => ({
    location: entry.location,
    snapshot: serializeSnapshot(entry.snapshot),
  }));
}
