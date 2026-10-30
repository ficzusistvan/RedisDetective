import type { RedisSnapshot } from '@redis-detective/core-types';

import { captureSnapshot } from './capture-snapshot.js';
import type { LibraryEngineDeps } from './library-engine-deps.js';
import type { LibrarySamplingOptions } from './library-sampling-options.js';
import { capturedSamplingFields } from './library-sampling-options.js';
import { serializeSnapshot } from './serialize-snapshot.js';
import { createFileSnapshotStore } from './snapshot-store.js';
import { withRedisConnection } from './with-redis-connection.js';

export interface LibrarySaveSnapshotOptions extends LibrarySamplingOptions {
  readonly url: string;
  /** Directory of `*.snapshot.json` files — the same path `--snapshots` takes. */
  readonly directory: string;
}

export interface SavedSnapshot {
  readonly location: string;
  readonly snapshot: RedisSnapshot;
}

/**
 * Samples the instance once and writes a snapshot file into `directory`.
 *
 * Creates the directory if it does not exist. Does not diagnose growth and does not print.
 */
export async function saveLibrarySnapshot(
  options: LibrarySaveSnapshotOptions,
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
