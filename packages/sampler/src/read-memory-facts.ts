import type { RedisMemoryFacts } from '@redis-detective/core-types';

import type { RedisInfoFields } from './parse-redis-info.js';
import { readNumericField } from './parse-redis-info.js';

/**
 * Reads the measured memory counters from `INFO memory` and `INFO stats`.
 *
 * These are the only numbers in a snapshot that are measured rather than extrapolated, which makes
 * them the backbone of anomaly detection later: pattern statistics are estimates, but a present
 * `used_memory` is ground truth about resident allocator memory.
 *
 * A missing `used_memory` stays `null`. Substituting `0` would record "the field was not there" as
 * "the dataset is empty", and the next sample could not tell them apart. An explicit `0` is kept:
 * on a multi-tier store that is bytes resident in RAM, not proof the keys are gone.
 *
 * `usedMemoryDatasetBytes` falls back to `used_memory` when the field is absent, because some
 * builds and managed providers omit it. That substitution is visible in the numbers rather than
 * silent, since dataset size would otherwise read as zero against a non-zero total. When
 * `used_memory` itself is missing, the fallback is `null` too.
 */
export function readMemoryFacts(fields: RedisInfoFields): RedisMemoryFacts {
  const usedMemoryBytes = readNumericField(fields, 'used_memory');

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
