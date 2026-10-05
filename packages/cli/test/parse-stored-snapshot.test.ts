import { describe, expect, it } from 'vitest';

import {
  SNAPSHOT_FILE_SCHEMA_VERSION,
  StoredSnapshotError,
  parseStoredSnapshot,
  serializeSnapshot,
} from '@redis-detective/cli';

import { snapshotFixture } from './helpers/snapshot-builder.js';

const location = '/tmp/snaps/example.snapshot.json';

function stored(snapshot: unknown, schemaVersion: unknown = SNAPSHOT_FILE_SCHEMA_VERSION): unknown {
  return { schemaVersion, snapshot };
}

describe('parseStoredSnapshot', () => {
  it('round-trips a serialized snapshot', () => {
    const snapshot = snapshotFixture();
    expect(parseStoredSnapshot(stored(serializeSnapshot(snapshot)), location)).toEqual(snapshot);
  });

  it('keeps a missing memory total as null', () => {
    const snapshot = snapshotFixture({
      memory: {
        ...snapshotFixture().memory,
        usedMemoryBytes: null,
        usedMemoryRssBytes: null,
        usedMemoryDatasetBytes: null,
        usedMemoryPeakBytes: null,
      },
    });

    expect(
      parseStoredSnapshot(stored(serializeSnapshot(snapshot)), location).memory.usedMemoryBytes,
    ).toBeNull();
  });

  it('rejects a missing schema version rather than guessing', () => {
    expect(() =>
      parseStoredSnapshot({ snapshot: serializeSnapshot(snapshotFixture()) }, location),
    ).toThrow(StoredSnapshotError);
  });

  it('rejects a different schema version', () => {
    expect(() =>
      parseStoredSnapshot(stored(serializeSnapshot(snapshotFixture()), 2), location),
    ).toThrow(/schemaVersion/);
  });

  it('rejects a missing field, naming the file so the user can go and look', () => {
    const snapshot = serializeSnapshot(snapshotFixture()) as unknown as Record<string, unknown>;
    delete snapshot['snapshotId'];

    expect(() => parseStoredSnapshot(stored(snapshot), location)).toThrow(/example.snapshot.json/);
    expect(() => parseStoredSnapshot(stored(snapshot), location)).toThrow(/snapshotId/);
  });

  it('rejects an unparseable timestamp', () => {
    const snapshot = { ...serializeSnapshot(snapshotFixture()), capturedAt: 'yesterday' };

    expect(() => parseStoredSnapshot(stored(snapshot), location)).toThrow(/ISO-8601/);
  });

  it('rejects a non-object', () => {
    expect(() => parseStoredSnapshot('not a snapshot', location)).toThrow(StoredSnapshotError);
  });
});
