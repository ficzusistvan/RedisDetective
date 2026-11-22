# Snapshot file format

On-disk snapshot files are the public contract between `redis-detective`, `@redis-detective/core`,
and any other reader (including the private web runner). A file is a JSON object:

```json
{
  "schemaVersion": 1,
  "snapshot": { ... RedisSnapshot ... }
}
```

`parseStoredSnapshot` validates every field. `serializeSnapshotFile` is the only supported writer
shape for new files.

## Versioning rules

- **Adding an optional field does not bump the version.** Older writers omit it; readers treat
  absence as the documented default (or reject if the field is required — do not add a required
  field without a bump).
- **Removing a field, renaming one, or changing what one means does bump the version.** Then:
  1. Increment `SNAPSHOT_FILE_SCHEMA_VERSION`.
  2. Add the previous version to `SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS` if it is not already
     listed.
  3. Register a migration in `SNAPSHOT_FILE_MIGRATIONS` from the old version to the next.
  4. Add a fixture that proves the old bytes still parse to the same logical snapshot.

Version 1 is the current format. Keep version-1 files **byte-for-byte** compatible: do not reorder
required fields in a way that changes serialized output for the same snapshot, and do not change
the meaning of any existing field without a bump.

## Reading older and newer files

`parseStoredSnapshot` accepts every version in `SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS`, runs
migrations up to `SNAPSHOT_FILE_SCHEMA_VERSION`, then validates the body.

| Input | Behaviour |
| --- | --- |
| Supported older version | Migrate up, then parse. |
| Current version | Parse as-is. |
| Integer version newer than this build | `StoredSnapshotError`: file was written by a newer redis-detective; names the version. |
| Missing or non-integer `schemaVersion` | `StoredSnapshotError` naming the bad value and the version this build reads. |

## JSON Schema

`snapshot-file.schema.json` (draft 2020-12) describes the version-1 envelope. Parser tests and the
schema must agree on every fixture under `fixtures/golden`.
