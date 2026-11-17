import type { RedisSnapshot } from '@redis-detective/core-types';

import type { LibrarySamplingOptions } from './library-sampling-options.js';

export interface SaveSnapshotOptions extends LibrarySamplingOptions {
  readonly url: string;
  /** Directory of `*.snapshot.json` files — the same path `--snapshots` takes. */
  readonly directory: string;
}

export interface SavedSnapshot {
  readonly location: string;
  readonly snapshot: RedisSnapshot;
}
