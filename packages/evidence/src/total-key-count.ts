import type { RedisSnapshot } from '@redis-detective/core-types';

/**
 * Total keys reported by `INFO keyspace` across every database in the snapshot.
 *
 * A measured figure, unlike the per-pattern key counts, which are extrapolated from the sample.
 * That distinction matters: key-count growth can be established from this even when the sample is
 * far too thin to say *which* pattern grew.
 */
export function totalKeyCount(snapshot: RedisSnapshot): number {
  return snapshot.keyspace.reduce((sum, entry) => sum + entry.keyCount, 0);
}
