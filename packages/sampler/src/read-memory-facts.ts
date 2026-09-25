import type { RedisMemoryFacts } from '@redis-detective/core-types';

import type { RedisInfoFields } from './parse-redis-info.js';
import { readNumericField } from './parse-redis-info.js';

/**
 * Reads the measured memory counters from `INFO memory` and `INFO stats`.
 *
 * These are the only numbers in a snapshot that are measured rather than extrapolated, which makes
 * them the backbone of anomaly detection later: pattern statistics are estimates, but
 * `used_memory` is ground truth.
 *
 * `usedMemoryDatasetBytes` falls back to `used_memory` when the field is absent, because some
 * builds and managed providers omit it. That substitution is visible in the numbers rather than
 * silent, since dataset size would otherwise read as zero against a non-zero total.
 */
export function readMemoryFacts(fields: RedisInfoFields): RedisMemoryFacts {
  const usedMemoryBytes = readNumericField(fields, 'used_memory') ?? 0;

  return {
    usedMemoryBytes,
    usedMemoryRssBytes: readNumericField(fields, 'used_memory_rss') ?? usedMemoryBytes,
    usedMemoryDatasetBytes: readNumericField(fields, 'used_memory_dataset') ?? usedMemoryBytes,
    usedMemoryPeakBytes: readNumericField(fields, 'used_memory_peak') ?? usedMemoryBytes,
    memFragmentationRatio: readNumericField(fields, 'mem_fragmentation_ratio') ?? 1,
    evictedKeys: readNumericField(fields, 'evicted_keys') ?? 0,
    expiredKeys: readNumericField(fields, 'expired_keys') ?? 0,
  };
}
