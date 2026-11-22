import type { RedisSnapshot } from '@redis-detective/core-types';

import { SNAPSHOT_FILE_SCHEMA_VERSION } from './parse-stored-snapshot.js';
import { serializeSnapshot } from './serialize-snapshot.js';

/**
 * On-disk envelope for a single snapshot file.
 *
 * The CLI and any other writer must go through this so the schema version and the field order stay
 * aligned with `parseStoredSnapshot`.
 */
export function serializeSnapshotFile(snapshot: RedisSnapshot): {
  readonly schemaVersion: typeof SNAPSHOT_FILE_SCHEMA_VERSION;
  readonly snapshot: RedisSnapshot;
} {
  return {
    schemaVersion: SNAPSHOT_FILE_SCHEMA_VERSION,
    snapshot: serializeSnapshot(snapshot),
  };
}
