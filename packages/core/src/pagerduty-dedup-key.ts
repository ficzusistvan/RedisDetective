import type { AlertIdentity } from './alert-fingerprint.js';
import { alertFingerprint } from './alert-fingerprint.js';

/**
 * PagerDuty Events API v2 `dedup_key`. Max 255 characters; we stay well under that.
 *
 * Same identity always produces the same key, so a resolve event from a later process
 * closes the trigger this host+pattern+rule opened.
 */
export function pagerdutyDedupKey(identity: AlertIdentity): string {
  return `rdv1:${alertFingerprint(identity).slice(0, 40)}`;
}
