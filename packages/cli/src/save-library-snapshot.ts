import { captureSnapshot } from './capture-snapshot.js';
import type { LibraryEngineDeps } from './library-engine-deps.js';
import { capturedSamplingFields } from './library-sampling-options.js';
import type { SaveSnapshotOptions, SavedSnapshot } from './save-snapshot-options.js';
import { serializeSnapshot } from './serialize-snapshot.js';
import { createFileSnapshotStore } from './snapshot-store.js';
import { withRedisConnection } from './with-redis-connection.js';

export type {
  SaveSnapshotOptions as LibrarySaveSnapshotOptions,
  SavedSnapshot,
} from './save-snapshot-options.js';

/**
 * Samples the instance once and writes a snapshot file into `directory`.
 *
 * Creates the directory if it does not exist. Does not diagnose growth and does not print.
 */
export async function saveLibrarySnapshot(
  options: SaveSnapshotOptions,
  deps: LibraryEngineDeps = {},
): Promise<SavedSnapshot> {
  const sampling = capturedSamplingFields(options);
  const snapshot = await withRedisConnection(
    options.url,
    (client) =>
      captureSnapshot({
        client,
        sampleSize: sampling.sampleSize,
        timeoutMs: sampling.timeoutMs,
        memorySamples: sampling.memorySamples,
        databases: sampling.databases,
        redactKeys: sampling.redactKeys,
      }),
    deps.connect,
  );
  const location = await createFileSnapshotStore(options.directory).save(snapshot);
  return { location, snapshot: serializeSnapshot(snapshot) };
}
