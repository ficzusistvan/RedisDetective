import type { RedisSnapshot } from '@redis-detective/core-types';

export class SnapshotOrderingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotOrderingError';
  }
}

/**
 * Returns the snapshots ordered oldest-first, without mutating the input.
 *
 * Every detector downstream assumes chronological order, so this normalisation happens once here
 * rather than being re-asserted in each of them. Ties break on `snapshotId` so that two snapshots
 * sharing a timestamp still produce a stable, reproducible order.
 */
export function sortSnapshotsChronologically(
  snapshots: readonly RedisSnapshot[],
): readonly RedisSnapshot[] {
  for (const snapshot of snapshots) {
    if (Number.isNaN(Date.parse(snapshot.capturedAt))) {
      throw new SnapshotOrderingError(
        `Snapshot ${snapshot.snapshotId} has an unparseable capturedAt: "${snapshot.capturedAt}".`,
      );
    }
  }

  return [...snapshots].sort((left, right) => {
    const delta = Date.parse(left.capturedAt) - Date.parse(right.capturedAt);
    return delta !== 0 ? delta : left.snapshotId.localeCompare(right.snapshotId);
  });
}
