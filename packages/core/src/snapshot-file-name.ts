import type { RedisSnapshot } from '@redis-detective/core-types';

const FILE_SUFFIX = '.snapshot.json';

/**
 * A filename that sorts chronologically and stays legible in a directory listing.
 *
 * The timestamp leads so that `ls` shows the series in order. Colons and dots are replaced because
 * they are not legal in filenames on Windows, and a snapshot directory is the sort of thing people
 * put in a shared repository.
 */
export function snapshotFileName(snapshot: RedisSnapshot): string {
  const stamp = snapshot.capturedAt.replace(/[:.]/g, '-');
  const id = snapshot.snapshotId.replace(/[^A-Za-z0-9_-]/g, '-');
  return `${stamp}--${id}${FILE_SUFFIX}`;
}
