import type { RedisSnapshot } from '@redis-detective/core';

export interface LoadedSnapshot {
  readonly location: string;
  readonly snapshot: RedisSnapshot;
}
