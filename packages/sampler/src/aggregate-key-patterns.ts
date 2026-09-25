import type { EstimateBasis, KeyPatternStats, RedisDataType } from '@redis-detective/core-types';

import type { ResolvedSamplerOptions } from './sampler-options.js';
import type { SampledKey } from './sampled-key.js';
import { inferKeyPattern } from './infer-key-pattern.js';

export interface AggregateKeyPatternsInput {
  readonly keys: readonly SampledKey[];
  /** `DBSIZE` total across sampled databases, used to scale the sample up. */
  readonly keyspaceSize: number;
  readonly options: ResolvedSamplerOptions;
  /** True when the sample covered the whole key space, making the figures exact. */
  readonly exhaustive: boolean;
}

/** Maximum example keys retained per pattern, enough to recognise the shape without a key dump. */
const MAX_EXAMPLE_KEYS = 3;

interface PatternBucket {
  readonly pattern: string;
  readonly dataType: RedisDataType;
  sampledKeyCount: number;
  sampledBytes: number;
  /** Keys whose `MEMORY USAGE` actually returned a figure. */
  keysWithBytes: number;
  keysWithTtl: number;
  keysWithoutTtl: number;
  readonly ttlSeconds: number[];
  readonly exampleKeys: string[];
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}

/**
 * Groups sampled keys by inferred pattern and extrapolates to the whole key space — the
 * `--bigkeys`-style view, computed from a bounded sample instead of a full scan.
 *
 * Pure and synchronous: it receives already-collected keys, so no Redis access happens here, which
 * is what makes it directly unit testable.
 *
 * Every figure is scaled by `keyspaceSize / sampledKeys` and marked `'sampled-extrapolation'`
 * unless the sample provably covered the whole key space. Presenting an extrapolated byte count as
 * measured is the specific dishonesty this function exists to avoid.
 */
export function aggregateKeyPatterns(input: AggregateKeyPatternsInput): readonly KeyPatternStats[] {
  const buckets = new Map<string, PatternBucket>();

  for (const sampled of input.keys) {
    const pattern = inferKeyPattern(sampled.key, input.options.patternDepth);
    const bucketKey = `${sampled.dataType}\u0000${pattern}`;

    let bucket = buckets.get(bucketKey);
    if (bucket === undefined) {
      bucket = {
        pattern,
        dataType: sampled.dataType,
        sampledKeyCount: 0,
        sampledBytes: 0,
        keysWithBytes: 0,
        keysWithTtl: 0,
        keysWithoutTtl: 0,
        ttlSeconds: [],
        exampleKeys: [],
      };
      buckets.set(bucketKey, bucket);
    }

    bucket.sampledKeyCount += 1;
    if (sampled.serializedBytes !== null) {
      bucket.sampledBytes += sampled.serializedBytes;
      bucket.keysWithBytes += 1;
    }

    if (sampled.ttlMs === null) {
      bucket.keysWithoutTtl += 1;
    } else {
      bucket.keysWithTtl += 1;
      bucket.ttlSeconds.push(sampled.ttlMs / 1_000);
    }

    if (bucket.exampleKeys.length < MAX_EXAMPLE_KEYS) {
      bucket.exampleKeys.push(sampled.key);
    }
  }

  const sampledKeyTotal = input.keys.length;
  // Scaling up a sample of zero keys would be division by zero; scaling an exhaustive sample would
  // inflate exact counts. Both cases mean "report what was measured".
  const scale =
    input.exhaustive || sampledKeyTotal === 0 || input.keyspaceSize <= sampledKeyTotal
      ? 1
      : input.keyspaceSize / sampledKeyTotal;
  const estimateBasis: EstimateBasis = input.exhaustive ? 'exact' : 'sampled-extrapolation';

  const stats: KeyPatternStats[] = [...buckets.values()].map((bucket) => ({
    pattern: bucket.pattern,
    dataType: bucket.dataType,
    sampledKeyCount: bucket.sampledKeyCount,
    sampledBytes: bucket.sampledBytes,
    estimatedKeyCount: Math.round(bucket.sampledKeyCount * scale),
    estimatedBytes: Math.round(bucket.sampledBytes * scale),
    keysWithTtl: bucket.keysWithTtl,
    keysWithoutTtl: bucket.keysWithoutTtl,
    bytesMeasured: bucket.keysWithBytes > 0,
    medianTtlSeconds: median([...bucket.ttlSeconds].sort((left, right) => left - right)),
    exampleKeys: bucket.exampleKeys,
    estimateBasis,
  }));

  // Deterministic order: repeated runs over identical input must produce identical output, so
  // every tie is broken explicitly rather than left to insertion order.
  return stats.sort(
    (left, right) =>
      right.estimatedBytes - left.estimatedBytes ||
      right.sampledKeyCount - left.sampledKeyCount ||
      left.pattern.localeCompare(right.pattern) ||
      left.dataType.localeCompare(right.dataType),
  );
}
