import type { AlertChannel } from './alert-channel.js';
import type { AlertFindingKind } from './alert-finding.js';

export const ALERT_STATUSES = ['firing', 'resolved'] as const;

export type AlertStatus = (typeof ALERT_STATUSES)[number];

export interface AlertStateRecord {
  readonly fingerprint: string;
  readonly dedupKey: string;
  readonly status: AlertStatus;
  readonly host: string;
  readonly pattern: string;
  readonly ruleId: string;
  readonly kind: AlertFindingKind;
  readonly firstFiredAt: string;
  readonly lastNotifiedAt: string;
  readonly lastResolvedAt: string | null;
  readonly notifiedChannels: readonly AlertChannel[];
}

export const ALERT_STATE_TRANSITIONS = [
  'notify-firing',
  'renotify',
  'notify-resolved',
  'suppress',
  'none',
] as const;

export type AlertStateTransition = (typeof ALERT_STATE_TRANSITIONS)[number];
