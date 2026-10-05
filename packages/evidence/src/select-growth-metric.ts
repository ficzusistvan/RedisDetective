import type { RedisSnapshot } from '@redis-detective/core-types';

import { totalKeyCount } from './total-key-count.js';

/** The two `INFO memory` counters that can stand in for "how much data is stored". */
export type GrowthMetric = 'used_memory_dataset' | 'used_memory';

/**
 * Chooses which memory counter to track growth against.
 *
 * `used_memory_dataset` is the better signal, because it excludes client output buffers and the
 * replication backlog and so tracks actual stored data. But not every Redis build and not every
 * managed provider reports it, and `readMemoryFacts` in the sampler substitutes `used_memory` when
 * the field is absent.
 *
 * That substitution is detected here by exact equality across every snapshot. On a live instance the
 * dataset is always strictly smaller than the total, so an exact match in every snapshot means we
 * are looking at the fallback rather than a real reading. Labelling an `AnomalyEvent`
 * `used_memory_dataset` when the number is really `used_memory` would misdescribe the evidence, and
 * every claim has to survive someone checking it against their own `INFO` output.
 */
export function selectGrowthMetric(snapshots: readonly RedisSnapshot[]): GrowthMetric {
  if (snapshots.length === 0) {
    return 'used_memory';
  }

  const datasetIsReported = snapshots.every(
    (snapshot) => snapshot.memory.usedMemoryDatasetBytes !== snapshot.memory.usedMemoryBytes,
  );

  return datasetIsReported ? 'used_memory_dataset' : 'used_memory';
}

/** Reads whichever counter `selectGrowthMetric` chose. `null` when that field was not reported. */
export function readGrowthMetric(snapshot: RedisSnapshot, metric: GrowthMetric): number | null {
  return metric === 'used_memory_dataset'
    ? snapshot.memory.usedMemoryDatasetBytes
    : snapshot.memory.usedMemoryBytes;
}

/**
 * The byte counter to diff for growth, or `null` when this snapshot does not describe stored size.
 *
 * A missing counter is unknown. A counter of exactly 0 while `INFO keyspace` still reports keys is
 * bytes resident in RAM, not an empty dataset: diffing that 0 would describe the data as having
 * disappeared and then grown from nothing. A 0 alongside an empty keyspace is a real empty
 * instance and stays 0, so growth from genuinely empty still compares as unbounded.
 */
export function comparableStoredBytes(
  snapshot: RedisSnapshot,
  metric: GrowthMetric,
): number | null {
  const bytes = readGrowthMetric(snapshot, metric);
  if (bytes === null || (bytes === 0 && totalKeyCount(snapshot) > 0)) {
    return null;
  }
  return bytes;
}
