import type { ALERT_PAYLOAD_SCHEMA_VERSION } from './alert-defaults.js';
import type { AlertAction } from './alert-action.js';
import type { AlertFindingKind } from './alert-finding.js';
import type { AlertSeverity } from './alert-severity.js';

/**
 * Versioned JSON body for the generic webhook (and the dry-run printout).
 *
 * `schemaVersion` is bumped on a breaking change. Consumers should ignore unknown fields.
 * No example keys, no webhook URLs, no routing keys, no Redis passwords.
 */
export interface AlertWebhookPayload {
  readonly schemaVersion: typeof ALERT_PAYLOAD_SCHEMA_VERSION;
  readonly event: AlertAction;
  readonly occurredAt: string;
  readonly host: string;
  readonly pattern: string;
  readonly dedupKey: string;
  readonly rule: {
    readonly id: string;
    readonly kind: AlertFindingKind;
    readonly severity: AlertSeverity;
  };
  readonly change: {
    readonly summary: string;
    readonly growthBytes: number | null;
    readonly growthPercent: number | null;
    readonly ttlCoverageBefore: number | null;
    readonly ttlCoverageAfter: number | null;
  };
  readonly likelyCause: {
    readonly pattern: string;
    readonly description: string;
  } | null;
  readonly commitHints: readonly {
    readonly sha: string;
    readonly shortSha: string;
    readonly message: string;
  }[];
}
