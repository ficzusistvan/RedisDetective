import type { RedisCommandClient } from './redis-command-client.js';
import type { ResolvedSamplerOptions } from './sampler-options.js';
import type { SampledKey } from './sampled-key.js';
import { isMissingKeyType, normalizeDataType } from './normalize-data-type.js';

export interface ScanKeySampleResult {
  readonly keys: readonly SampledKey[];
  readonly scanPasses: number;
  /** Total keys reported by `DBSIZE` across the sampled databases, for extrapolation. */
  readonly keyspaceSize: number;
  /** True when a hard bound stopped the scan before it had gathered its target sample. */
  readonly truncated: boolean;
  /** True when the whole key space was small enough to visit in full, making counts exact. */
  readonly exhaustive: boolean;
  readonly warnings: readonly string[];
}

export interface ScanKeySampleDeps {
  readonly now: () => number;
  readonly random: () => number;
}

export const DEFAULT_SCAN_KEY_SAMPLE_DEPS: ScanKeySampleDeps = {
  now: () => Date.now(),
  random: () => Math.random(),
};

/**
 * SCAN walks a hash table whose bucket count is a power of two at least as large as the key count.
 * Starting from a random bucket stops every run from resampling the head of the table, which
 * matters because a partial scan from cursor 0 returns the same keys every time and would make
 * growth in the unvisited remainder invisible.
 */
function randomStartCursor(dbSize: number, random: () => number): string {
  if (dbSize <= 1) {
    return '0';
  }
  const tableSize = 2 ** Math.ceil(Math.log2(dbSize));
  return String(Math.floor(random() * tableSize));
}

interface KeyBudget {
  readonly total: number;
  readonly exhaustive: boolean;
}

/**
 * Decides how many keys may be visited.
 *
 * A key space smaller than the ceiling is visited in full: it is cheap, bounded, and yields exact
 * counts rather than extrapolations. Above the ceiling, `maxSampleRate` keeps the work proportional
 * to instance size instead of flat.
 */
function resolveKeyBudget(keyspaceSize: number, options: ResolvedSamplerOptions): KeyBudget {
  if (keyspaceSize <= options.maxSampledKeys) {
    return { total: keyspaceSize, exhaustive: true };
  }
  const rateCap = Math.ceil(keyspaceSize * options.maxSampleRate);
  return { total: Math.min(options.maxSampledKeys, rateCap), exhaustive: false };
}

/**
 * Collects a bounded, randomized sample of keys with their type, TTL and size.
 *
 * Every one of the four bounds is load-bearing and all four are re-checked on every iteration of
 * the scan loop — see this package's AGENTS.md. In particular a small `scanCount` with unbounded
 * passes still walks the entire key space, so the pass ceiling is not optional. The clock and the
 * randomness source are injected so the bound assertions in the tests are deterministic.
 *
 * Degrades rather than fails: if `MEMORY USAGE` is unavailable, which managed providers sometimes
 * enforce, sampling continues without byte figures and records a warning. A partial snapshot is
 * still useful during an incident; an exception is not.
 */
export async function scanKeySample(
  client: RedisCommandClient,
  options: ResolvedSamplerOptions,
  deps: ScanKeySampleDeps = DEFAULT_SCAN_KEY_SAMPLE_DEPS,
): Promise<ScanKeySampleResult> {
  const deadline = deps.now() + options.maxDurationMs;
  const warnings: string[] = [];
  const collected: SampledKey[] = [];

  let scanPasses = 0;
  let keyspaceSize = 0;
  let truncated = false;
  let memoryUsageAvailable = true;

  const dbSizes = new Map<number, number>();
  for (const db of options.databases) {
    await client.select(db);
    const size = await client.dbSize();
    dbSizes.set(db, size);
    keyspaceSize += size;
  }

  const budget = resolveKeyBudget(keyspaceSize, options);

  const readMemoryUsage = async (key: string): Promise<number | null> => {
    if (!memoryUsageAvailable) {
      return null;
    }
    try {
      return await client.memoryUsage(key, { samples: options.memoryUsageSamples });
    } catch {
      // Blocked or unsupported. Stop asking rather than failing once per key.
      memoryUsageAvailable = false;
      warnings.push(
        'MEMORY USAGE is unavailable on this instance, so per-pattern byte figures are omitted.',
      );
      return null;
    }
  };

  for (const db of options.databases) {
    const dbSize = dbSizes.get(db) ?? 0;
    if (dbSize === 0 || budget.total === 0) {
      continue;
    }

    // Share the budget in proportion to each database's size, so a large db0 is not starved by
    // iteration order.
    const dbBudget =
      options.databases.length === 1
        ? budget.total
        : Math.max(1, Math.round((budget.total * dbSize) / keyspaceSize));

    await client.select(db);

    let cursor = budget.exhaustive ? '0' : randomStartCursor(dbSize, deps.random);
    let dbCollected = 0;
    let wrapped = budget.exhaustive;

    while (dbCollected < dbBudget) {
      if (deps.now() >= deadline) {
        truncated = true;
        warnings.push(`Sampling stopped after ${options.maxDurationMs}ms deadline.`);
        break;
      }
      if (scanPasses >= options.maxScanPasses) {
        truncated = true;
        warnings.push(`Sampling stopped after the ${options.maxScanPasses}-pass ceiling.`);
        break;
      }

      const response = await client.scan({ cursor, count: options.scanCount });
      scanPasses += 1;

      for (const key of response.keys) {
        if (dbCollected >= dbBudget) {
          break;
        }

        const typeReply = await client.type(key);
        // The key expired between SCAN and TYPE. Skipping keeps it out of the sample rather than
        // recording a zero-byte key that never really existed.
        if (isMissingKeyType(typeReply)) {
          continue;
        }

        const ttlMs = await client.pttl(key);
        collected.push({
          key,
          db,
          dataType: normalizeDataType(typeReply),
          serializedBytes: await readMemoryUsage(key),
          ttlMs: ttlMs === null || ttlMs < 0 ? null : ttlMs,
        });
        dbCollected += 1;
      }

      if (response.cursor === '0') {
        // A random start cursor can land near the end of the table. Wrap to the beginning once so
        // the sample size reflects the budget rather than where the cursor happened to start.
        if (!wrapped && dbCollected < dbBudget) {
          cursor = '0';
          wrapped = true;
          continue;
        }
        break;
      }
      cursor = response.cursor;
    }
  }

  if (collected.length === 0 && keyspaceSize > 0) {
    warnings.push('No keys were sampled despite a non-empty key space.');
  }

  return {
    keys: collected,
    scanPasses,
    keyspaceSize,
    truncated,
    exhaustive: budget.exhaustive && !truncated && collected.length >= keyspaceSize,
    warnings,
  };
}
