import type {
  RedisDeploymentMode,
  RedisInstanceIdentity,
  RedisRole,
} from '@redis-detective/core-types';

import type { RedisInfoFields } from './parse-redis-info.js';
import { readNumericField, readStringField } from './parse-redis-info.js';

function readMode(fields: RedisInfoFields): RedisDeploymentMode {
  switch (readStringField(fields, 'redis_mode')) {
    case 'standalone':
      return 'standalone';
    case 'cluster':
      return 'cluster';
    case 'sentinel':
      return 'sentinel';
    default:
      return 'unknown';
  }
}

function readRole(fields: RedisInfoFields): RedisRole {
  switch (readStringField(fields, 'role')) {
    case 'master':
      return 'master';
    case 'slave':
    case 'replica':
      return 'replica';
    default:
      return 'unknown';
  }
}

/**
 * Reads instance identity from `INFO`.
 *
 * Unknown values are represented as `'unknown'` or `null` rather than guessed at. Managed Redis
 * providers redact parts of `INFO`, and a snapshot that admits it does not know the role is far
 * more useful than one that quietly claims `master`.
 */
export function readInstanceIdentity(fields: RedisInfoFields): RedisInstanceIdentity {
  const maxmemoryBytes = readNumericField(fields, 'maxmemory');

  return {
    redisVersion: readStringField(fields, 'redis_version') ?? 'unknown',
    mode: readMode(fields),
    role: readRole(fields),
    // Redis reports `maxmemory:0` when no ceiling is configured, which is not a real limit.
    maxmemoryBytes: maxmemoryBytes === null || maxmemoryBytes <= 0 ? null : maxmemoryBytes,
    maxmemoryPolicy: readStringField(fields, 'maxmemory_policy') ?? 'unknown',
    uptimeSeconds: readNumericField(fields, 'uptime_in_seconds') ?? 0,
  };
}
