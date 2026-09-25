import { REDIS_DATA_TYPES } from '@redis-detective/core-types';
import type {
  EstimateBasis,
  KeyPatternStats,
  RedisDataType,
  RedisDeploymentMode,
  RedisKeyspaceFacts,
  RedisRole,
  RedisSnapshot,
  SamplingMetadata,
} from '@redis-detective/core-types';

/**
 * Bumped whenever the stored shape changes incompatibly.
 *
 * Snapshots are written by one run and read by another, potentially weeks and one `git pull` apart.
 * Without a version, an old file silently missing a field the detectors now read would produce a
 * confident diagnosis from partial data.
 */
export const SNAPSHOT_FILE_SCHEMA_VERSION = 1;

export class StoredSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredSnapshotError';
  }
}

const DEPLOYMENT_MODES: readonly RedisDeploymentMode[] = [
  'standalone',
  'cluster',
  'sentinel',
  'unknown',
];
const ROLES: readonly RedisRole[] = ['master', 'replica', 'unknown'];
const ESTIMATE_BASES: readonly EstimateBasis[] = ['sampled-extrapolation', 'exact'];

function fail(path: string, expectation: string, received: unknown): never {
  throw new StoredSnapshotError(
    `${path} ${expectation}, received ${JSON.stringify(received) ?? 'undefined'}.`,
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object', value);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, 'must be an array', value);
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(path, 'must be a string', value);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number', value);
  }
  return value;
}

function nullableFiniteNumber(value: unknown, path: string): number | null {
  return value === null ? null : finiteNumber(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(path, 'must be a boolean', value);
  }
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  return array(value, path).map((entry, index) => text(entry, `${path}[${index}]`));
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const candidate = text(value, path);
  const match = allowed.find((entry) => entry === candidate);
  if (match === undefined) {
    fail(path, `must be one of ${allowed.join(', ')}`, value);
  }
  return match;
}

function timestamp(value: unknown, path: string): string {
  const candidate = text(value, path);
  if (Number.isNaN(Date.parse(candidate))) {
    fail(path, 'must be an ISO-8601 timestamp', value);
  }
  return candidate;
}

function parsePattern(value: unknown, path: string): KeyPatternStats {
  const raw = record(value, path);

  return {
    pattern: text(raw['pattern'], `${path}.pattern`),
    dataType: oneOf<RedisDataType>(raw['dataType'], `${path}.dataType`, REDIS_DATA_TYPES),
    sampledKeyCount: finiteNumber(raw['sampledKeyCount'], `${path}.sampledKeyCount`),
    sampledBytes: finiteNumber(raw['sampledBytes'], `${path}.sampledBytes`),
    estimatedKeyCount: finiteNumber(raw['estimatedKeyCount'], `${path}.estimatedKeyCount`),
    estimatedBytes: finiteNumber(raw['estimatedBytes'], `${path}.estimatedBytes`),
    bytesMeasured: boolean(raw['bytesMeasured'], `${path}.bytesMeasured`),
    keysWithTtl: finiteNumber(raw['keysWithTtl'], `${path}.keysWithTtl`),
    keysWithoutTtl: finiteNumber(raw['keysWithoutTtl'], `${path}.keysWithoutTtl`),
    medianTtlSeconds: nullableFiniteNumber(raw['medianTtlSeconds'], `${path}.medianTtlSeconds`),
    exampleKeys: stringArray(raw['exampleKeys'], `${path}.exampleKeys`),
    estimateBasis: oneOf<EstimateBasis>(
      raw['estimateBasis'],
      `${path}.estimateBasis`,
      ESTIMATE_BASES,
    ),
  };
}

function parseKeyspace(value: unknown, path: string): RedisKeyspaceFacts {
  const raw = record(value, path);

  return {
    db: finiteNumber(raw['db'], `${path}.db`),
    keyCount: finiteNumber(raw['keyCount'], `${path}.keyCount`),
    keysWithExpiry: finiteNumber(raw['keysWithExpiry'], `${path}.keysWithExpiry`),
    averageTtlMs: nullableFiniteNumber(raw['averageTtlMs'], `${path}.averageTtlMs`),
  };
}

function parseSampling(value: unknown, path: string): SamplingMetadata {
  const raw = record(value, path);

  return {
    strategy: oneOf(raw['strategy'], `${path}.strategy`, ['randomized-scan'] as const),
    requestedSampleSize: finiteNumber(raw['requestedSampleSize'], `${path}.requestedSampleSize`),
    observedSampleSize: finiteNumber(raw['observedSampleSize'], `${path}.observedSampleSize`),
    scanPasses: finiteNumber(raw['scanPasses'], `${path}.scanPasses`),
    effectiveSampleRate: finiteNumber(raw['effectiveSampleRate'], `${path}.effectiveSampleRate`),
    durationMs: finiteNumber(raw['durationMs'], `${path}.durationMs`),
    truncated: boolean(raw['truncated'], `${path}.truncated`),
    warnings: stringArray(raw['warnings'], `${path}.warnings`),
  };
}

/**
 * Narrows the contents of a stored snapshot file to a `RedisSnapshot`, or throws.
 *
 * Every field is checked rather than cast. A snapshot file is untrusted input: it may have been
 * hand-edited, truncated by a full disk, written by an older version of this tool, or simply be a
 * different JSON file that happened to be in the directory. A single `as RedisSnapshot` would let
 * any of those through, and the failure would not surface as a parse error — it would surface as a
 * diagnosis, with `undefined` arithmetic quietly producing `NaN` growth that no detector reports and
 * no user can question.
 *
 * `location` appears in every message, because the useful response to a bad file is to go and look
 * at it.
 */
export function parseStoredSnapshot(contents: unknown, location: string): RedisSnapshot {
  const file = record(contents, location);

  const version = file['schemaVersion'];
  if (version !== SNAPSHOT_FILE_SCHEMA_VERSION) {
    throw new StoredSnapshotError(
      `${location} has schemaVersion ${JSON.stringify(version)}, but this build reads version ${SNAPSHOT_FILE_SCHEMA_VERSION}. Delete the file and take a fresh snapshot.`,
    );
  }

  const path = `${location}.snapshot`;
  const raw = record(file['snapshot'], path);
  const instance = record(raw['instance'], `${path}.instance`);
  const memory = record(raw['memory'], `${path}.memory`);

  return {
    snapshotId: text(raw['snapshotId'], `${path}.snapshotId`),
    capturedAt: timestamp(raw['capturedAt'], `${path}.capturedAt`),
    instance: {
      redisVersion: text(instance['redisVersion'], `${path}.instance.redisVersion`),
      mode: oneOf<RedisDeploymentMode>(
        instance['mode'],
        `${path}.instance.mode`,
        DEPLOYMENT_MODES,
      ),
      role: oneOf<RedisRole>(instance['role'], `${path}.instance.role`, ROLES),
      maxmemoryBytes: nullableFiniteNumber(
        instance['maxmemoryBytes'],
        `${path}.instance.maxmemoryBytes`,
      ),
      maxmemoryPolicy: text(instance['maxmemoryPolicy'], `${path}.instance.maxmemoryPolicy`),
      uptimeSeconds: finiteNumber(instance['uptimeSeconds'], `${path}.instance.uptimeSeconds`),
    },
    memory: {
      usedMemoryBytes: finiteNumber(memory['usedMemoryBytes'], `${path}.memory.usedMemoryBytes`),
      usedMemoryRssBytes: finiteNumber(
        memory['usedMemoryRssBytes'],
        `${path}.memory.usedMemoryRssBytes`,
      ),
      usedMemoryDatasetBytes: finiteNumber(
        memory['usedMemoryDatasetBytes'],
        `${path}.memory.usedMemoryDatasetBytes`,
      ),
      usedMemoryPeakBytes: finiteNumber(
        memory['usedMemoryPeakBytes'],
        `${path}.memory.usedMemoryPeakBytes`,
      ),
      memFragmentationRatio: finiteNumber(
        memory['memFragmentationRatio'],
        `${path}.memory.memFragmentationRatio`,
      ),
      evictedKeys: finiteNumber(memory['evictedKeys'], `${path}.memory.evictedKeys`),
      expiredKeys: finiteNumber(memory['expiredKeys'], `${path}.memory.expiredKeys`),
    },
    keyspace: array(raw['keyspace'], `${path}.keyspace`).map((entry, index) =>
      parseKeyspace(entry, `${path}.keyspace[${index}]`),
    ),
    patterns: array(raw['patterns'], `${path}.patterns`).map((entry, index) =>
      parsePattern(entry, `${path}.patterns[${index}]`),
    ),
    sampling: parseSampling(raw['sampling'], `${path}.sampling`),
  };
}
