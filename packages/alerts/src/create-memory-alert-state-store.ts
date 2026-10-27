import type { AlertStateRecord } from './alert-state-record.js';
import type { AlertStateStore } from './alert-state-store.js';

export function createMemoryAlertStateStore(
  initial: readonly AlertStateRecord[] = [],
): AlertStateStore {
  let records = [...initial];
  return {
    describe: 'memory',
    load: () => Promise.resolve(records),
    save: (next) => {
      records = [...next];
      return Promise.resolve();
    },
  };
}
