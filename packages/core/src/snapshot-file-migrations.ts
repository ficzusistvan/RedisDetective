/**
 * Migrations from older on-disk snapshot schema versions up to the current one.
 *
 * Adding an optional field does not bump the version. Removing, renaming, or changing the meaning
 * of a field does — see SNAPSHOT_FORMAT.md. Each bump needs an entry here and a fixture.
 *
 * Keys are the version *before* the migration runs; the function returns the file contents at the
 * next version. The parser walks this registry until `SNAPSHOT_FILE_SCHEMA_VERSION` is reached.
 */
export type SnapshotFileMigration = (file: Record<string, unknown>) => Record<string, unknown>;

/**
 * Empty while only version 1 exists. When version 2 ships, add `1: migrateV1ToV2`.
 */
export const SNAPSHOT_FILE_MIGRATIONS: Readonly<Record<number, SnapshotFileMigration>> = {};
