import { describe, expect, it } from 'vitest';

import { transitionAlertState } from '@redis-detective/alerts';
import type { AlertStateRecord } from '@redis-detective/alerts';

const HOUR = 60 * 60 * 1_000;
const T0 = Date.parse('2026-10-25T12:00:00.000Z');

const template = {
  fingerprint: 'abc',
  dedupKey: 'rdv1:abc',
  host: 'redis://localhost:6379',
  pattern: 'session:*',
  ruleId: 'cli',
  kind: 'ttl-coverage-drop' as const,
};

function firingRecord(at = '2026-10-25T12:00:00.000Z'): AlertStateRecord {
  return {
    ...template,
    status: 'firing',
    firstFiredAt: at,
    lastNotifiedAt: at,
    lastResolvedAt: null,
    notifiedChannels: ['slack'],
  };
}

describe('transitionAlertState', () => {
  it('fires on the first finding', () => {
    const decision = transitionAlertState({
      previous: null,
      firing: true,
      nowMs: T0,
      cooldownMs: HOUR,
      occurredAt: '2026-10-25T12:00:00.000Z',
      template,
    });

    expect(decision.transition).toBe('notify-firing');
    expect(decision.next?.status).toBe('firing');
    expect(decision.next?.firstFiredAt).toBe('2026-10-25T12:00:00.000Z');
  });

  it('suppresses a persistent breach inside the cooldown', () => {
    const decision = transitionAlertState({
      previous: firingRecord(),
      firing: true,
      nowMs: T0 + 10 * 60 * 1_000,
      cooldownMs: HOUR,
      occurredAt: '2026-10-25T12:10:00.000Z',
      template,
    });

    expect(decision.transition).toBe('suppress');
    expect(decision.next?.lastNotifiedAt).toBe('2026-10-25T12:00:00.000Z');
  });

  it('re-notifies after the cooldown elapses', () => {
    const decision = transitionAlertState({
      previous: firingRecord(),
      firing: true,
      nowMs: T0 + HOUR,
      cooldownMs: HOUR,
      occurredAt: '2026-10-25T13:00:00.000Z',
      template,
    });

    expect(decision.transition).toBe('renotify');
    expect(decision.next?.lastNotifiedAt).toBe('2026-10-25T13:00:00.000Z');
    expect(decision.next?.firstFiredAt).toBe('2026-10-25T12:00:00.000Z');
  });

  it('resolves immediately when the condition clears', () => {
    const decision = transitionAlertState({
      previous: firingRecord(),
      firing: false,
      nowMs: T0 + 1_000,
      cooldownMs: HOUR,
      occurredAt: '2026-10-25T12:00:01.000Z',
      template,
    });

    expect(decision.transition).toBe('notify-resolved');
    expect(decision.next?.status).toBe('resolved');
    expect(decision.next?.lastResolvedAt).toBe('2026-10-25T12:00:01.000Z');
  });

  it('does nothing when already resolved and still clear', () => {
    const previous: AlertStateRecord = {
      ...firingRecord(),
      status: 'resolved',
      lastResolvedAt: '2026-10-25T11:00:00.000Z',
    };
    const decision = transitionAlertState({
      previous,
      firing: false,
      nowMs: T0,
      cooldownMs: HOUR,
      occurredAt: '2026-10-25T12:00:00.000Z',
      template,
    });

    expect(decision.transition).toBe('none');
    expect(decision.next).toBe(previous);
  });

  it('fires again after a prior resolve (new incident)', () => {
    const previous: AlertStateRecord = {
      ...firingRecord('2026-10-24T12:00:00.000Z'),
      status: 'resolved',
      lastResolvedAt: '2026-10-24T13:00:00.000Z',
    };
    const decision = transitionAlertState({
      previous,
      firing: true,
      nowMs: T0,
      cooldownMs: HOUR,
      occurredAt: '2026-10-25T12:00:00.000Z',
      template,
    });

    expect(decision.transition).toBe('notify-firing');
    expect(decision.next?.firstFiredAt).toBe('2026-10-25T12:00:00.000Z');
    expect(decision.next?.lastResolvedAt).toBe('2026-10-24T13:00:00.000Z');
  });

  it('treats a restart inside the cooldown as suppress, not a new fire', () => {
    const decision = transitionAlertState({
      previous: firingRecord(),
      firing: true,
      nowMs: T0 + 30 * 60 * 1_000,
      cooldownMs: HOUR,
      occurredAt: '2026-10-25T12:30:00.000Z',
      template,
    });

    expect(decision.transition).toBe('suppress');
  });
});
