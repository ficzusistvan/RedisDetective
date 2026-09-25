import type { RedisDataType } from '@redis-detective/core-types';

/**
 * Maps a `TYPE` reply onto `RedisDataType`.
 *
 * Unrecognised replies become `'unknown'` rather than being dropped: modules such as RedisJSON and
 * RediSearch report their own type names, and a key that is large but of an unfamiliar type is
 * exactly the kind of thing a memory report should still surface.
 */
export function normalizeDataType(reply: string): RedisDataType {
  switch (reply.trim().toLowerCase()) {
    case 'string':
      return 'string';
    case 'list':
      return 'list';
    case 'set':
      return 'set';
    case 'zset':
      return 'zset';
    case 'hash':
      return 'hash';
    case 'stream':
      return 'stream';
    default:
      return 'unknown';
  }
}

/** `TYPE` answers `none` for a key that no longer exists. */
export function isMissingKeyType(reply: string): boolean {
  return reply.trim().toLowerCase() === 'none';
}
