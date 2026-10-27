import type { AlertStateRecord, AlertStateTransition } from './alert-state-record.js';

export interface TransitionAlertStateRequest {
  readonly previous: AlertStateRecord | null;
  readonly firing: boolean;
  readonly nowMs: number;
  readonly cooldownMs: number;
  readonly occurredAt: string;
  readonly template: Omit<
    AlertStateRecord,
    | 'status'
    | 'firstFiredAt'
    | 'lastNotifiedAt'
    | 'lastResolvedAt'
    | 'notifiedChannels'
    | 'lastFinding'
  > & {
    readonly lastFinding?: AlertStateRecord['lastFinding'];
  };
}

export interface AlertStateDecision {
  readonly next: AlertStateRecord | null;
  readonly transition: AlertStateTransition;
}

/**
 * Pure firing → resolved machine with cooldown.
 *
 * A persistent breach re-notifies only after `cooldownMs` (default one hour) so a 15-minute
 * watch tick cannot page every interval. Resolve is immediate when the condition clears.
 * Restart safety comes from feeding the previous record back in — the first fire after a
 * reboot is suppressed if the stored `lastNotifiedAt` is still inside the cooldown.
 */
export function transitionAlertState(request: TransitionAlertStateRequest): AlertStateDecision {
  const { previous, firing, nowMs, cooldownMs, occurredAt, template } = request;

  if (firing) {
    if (previous === null || previous.status === 'resolved') {
      return {
        transition: 'notify-firing',
        next: {
          ...template,
          status: 'firing',
          firstFiredAt: occurredAt,
          lastNotifiedAt: occurredAt,
          lastResolvedAt: previous?.lastResolvedAt ?? null,
          notifiedChannels: [],
          lastFinding: template.lastFinding ?? previous?.lastFinding ?? null,
        },
      };
    }

    const elapsed = nowMs - Date.parse(previous.lastNotifiedAt);
    const cooldownElapsed = !Number.isFinite(elapsed) || elapsed >= cooldownMs;
    if (!cooldownElapsed) {
      return { transition: 'suppress', next: previous };
    }

    return {
      transition: 'renotify',
      next: {
        ...previous,
        ...template,
        status: 'firing',
        lastNotifiedAt: occurredAt,
        lastFinding: template.lastFinding ?? previous.lastFinding,
      },
    };
  }

  if (previous === null || previous.status === 'resolved') {
    return { transition: 'none', next: previous };
  }

  return {
    transition: 'notify-resolved',
    next: {
      ...previous,
      status: 'resolved',
      lastResolvedAt: occurredAt,
    },
  };
}
