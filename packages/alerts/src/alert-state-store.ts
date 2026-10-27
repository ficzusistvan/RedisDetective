import type { AlertStateRecord } from './alert-state-record.js';

/**
 * Persistence for the firing/resolved machine. Injected so tests use memory and production
 * uses a small JSON file next to the snapshot directory.
 */
export interface AlertStateStore {
  readonly describe: string;
  load(): Promise<readonly AlertStateRecord[]>;
  save(records: readonly AlertStateRecord[]): Promise<void>;
}
