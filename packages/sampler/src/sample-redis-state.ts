import type {
  RedisKeyspaceFacts,
  RedisMemoryFacts,
  RedisSnapshot,
  SamplingMetadata,
} from '@redis-detective/core-types';

import type { RedisCommandClient } from './redis-command-client.js';
import type { SamplerOptions } from './sampler-options.js';
import { resolveSamplerOptions } from './sampler-options.js';
import { aggregateKeyPatterns } from './aggregate-key-patterns.js';
import { parseKeyspaceFacts } from './parse-keyspace-facts.js';
import { parseRedisInfo } from './parse-redis-info.js';
import { readInstanceIdentity } from './read-instance-identity.js';
import { readMemoryFacts } from './read-memory-facts.js';
import { scanKeySample } from './scan-key-sample.js';

/**
 * Ambient inputs, injected so that snapshots are reproducible in tests and so nothing in this
 * package reads a global clock or a global random source.
 */
export interface SampleRedisStateDeps {
  readonly now: () => Date;
  readonly newSnapshotId: () => string;
  readonly random: () => number;
}

export const DEFAULT_SAMPLE_REDIS_STATE_DEPS: SampleRedisStateDeps = {
  now: () => new Date(),
  newSnapshotId: () => globalThis.crypto.randomUUID(),
  random: () => Math.random(),
};

/** Sections requested in one round trip. `everything` would add latency for data we do not use. */
const INFO_SECTIONS = ['server', 'memory', 'stats', 'keyspace', 'replication'] as const;

/**
 * Says when the memory total cannot be read as "how much data is stored".
 *
 * A missing field is unknown. A zero beside a non-empty keyspace is resident RAM — a quiet
 * multi-tier database can drop untouched data from memory and still report the keys — so recording
 * it as an empty dataset would be a different claim from the one `INFO` made.
 */
function memoryReadingWarnings(
  memory: RedisMemoryFacts,
  keyspace: readonly RedisKeyspaceFacts[],
): readonly string[] {
  if (memory.usedMemoryBytes === null) {
    return ['used_memory was absent from INFO, so this snapshot has no memory total.'];
  }

  const keyCount = keyspace.reduce((sum, entry) => sum + entry.keyCount, 0);
  if (memory.usedMemoryBytes === 0 && keyCount > 0) {
    return [
      `used_memory is 0 bytes while the keyspace reports ${keyCount} keys. That is resident memory, not an empty dataset.`,
    ];
  }

  return [];
}

async function readInfo(client: RedisCommandClient): Promise<string> {
  const sections: string[] = [];
  for (const section of INFO_SECTIONS) {
    sections.push(await client.info(section));
  }
  return sections.join('\n');
}

/**
 * Captures one `RedisSnapshot`: measured `INFO` facts plus sampled per-pattern statistics.
 *
 * Read-only and bounded. The permitted command set is exactly what `RedisCommandClient` exposes,
 * and the bounds come from `resolveSamplerOptions`, which clamps rather than trusts the caller.
 * Read this package's AGENTS.md before changing any of that.
 *
 * Clamps applied to the caller's options are surfaced in `sampling.warnings` rather than swallowed,
 * so a user who asked for a bigger sample than allowed is told they did not get it.
 */
export async function sampleRedisState(
  client: RedisCommandClient,
  options: SamplerOptions = {},
  deps: SampleRedisStateDeps = DEFAULT_SAMPLE_REDIS_STATE_DEPS,
): Promise<RedisSnapshot> {
  const resolved = resolveSamplerOptions(options);
  const startedAt = deps.now();

  const fields = parseRedisInfo(await readInfo(client));
  const memory = readMemoryFacts(fields);
  const keyspace = parseKeyspaceFacts(fields);

  const sample = await scanKeySample(client, resolved, {
    now: () => deps.now().getTime(),
    random: deps.random,
  });

  const patterns = aggregateKeyPatterns({
    keys: sample.keys,
    keyspaceSize: sample.keyspaceSize,
    options: resolved,
    exhaustive: sample.exhaustive,
  });

  const finishedAt = deps.now();

  const sampling: SamplingMetadata = {
    strategy: 'randomized-scan',
    requestedSampleSize: resolved.maxSampledKeys,
    observedSampleSize: sample.keys.length,
    scanPasses: sample.scanPasses,
    effectiveSampleRate: sample.keyspaceSize > 0 ? sample.keys.length / sample.keyspaceSize : 0,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    truncated: sample.truncated,
    warnings: [
      ...resolved.clamped.map((clamp) => `Requested sampling bound was reduced: ${clamp}.`),
      ...sample.warnings,
      ...memoryReadingWarnings(memory, keyspace),
    ],
  };

  return {
    snapshotId: deps.newSnapshotId(),
    capturedAt: startedAt.toISOString(),
    instance: readInstanceIdentity(fields),
    memory,
    keyspace,
    patterns,
    sampling,
  };
}
