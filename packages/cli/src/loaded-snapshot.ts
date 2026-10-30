import type { RedisSnapshot } from '@redis-detective/core-types';

export interface LoadedSnapshot {
  readonly location: string;
  readonly snapshot: RedisSnapshot;
}
