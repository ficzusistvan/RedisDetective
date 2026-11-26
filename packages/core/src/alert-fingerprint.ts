import type { AlertFindingKind } from './alert-finding.js';
import { sha256Hex } from './sha256-hex.js';

export interface AlertIdentity {
  readonly host: string;
  readonly pattern: string;
  readonly ruleId: string;
  readonly kind: AlertFindingKind;
}

/**
 * Stable identity for one (host, pattern, rule, finding-kind) incident.
 *
 * Used as the state-file key and as the input to the PagerDuty `dedup_key`. The hash is
 * deterministic so a restarted `watch` process can resolve the same incident it opened.
 */
export function alertFingerprint(identity: AlertIdentity): string {
  const canonical = [identity.host, identity.pattern, identity.ruleId, identity.kind].join('\0');
  return sha256Hex(canonical);
}
