import type { RedisSnapshot } from '@redis-detective/core-types';

export const REDACTED_KEY = '<redacted>';

/**
 * Replaces every example key with a placeholder.
 *
 * Example keys are real key names, and real key names routinely embed identifiers — user ids,
 * email addresses, tenant names, order references. That is fine on the operator's own terminal,
 * but a `--json` report gets written to a file and attached to a ticket, so `--redact-keys` exists
 * for anyone who needs to share the diagnosis without sharing the data.
 *
 * Applied to the snapshot *before* findings are derived, because finding text quotes example keys
 * too. Redacting the report afterwards would leave them in the prose.
 *
 * Pure: returns a new snapshot and leaves the input untouched.
 */
export function redactExampleKeys(snapshot: RedisSnapshot): RedisSnapshot {
  return {
    ...snapshot,
    patterns: snapshot.patterns.map((pattern) => ({
      ...pattern,
      exampleKeys: pattern.exampleKeys.length === 0 ? [] : [REDACTED_KEY],
    })),
  };
}
