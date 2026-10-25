import { describe, expect, it } from 'vitest';

import { createMemoryAlertStateStore, processAlertTick } from '@redis-detective/alerts';
import type { Notifier, NotifierResult } from '@redis-detective/alerts';

import { TTL_DROP_FINDING, sampleRule } from './helpers/sample-finding.js';

const HOST = 'redis://localhost:6379/';
const HOUR = 60 * 60 * 1_000;

function recordingNotifier(): { notifier: Notifier; actions: string[] } {
  const actions: string[] = [];
  const notifier: Notifier = {
    channel: 'webhook',
    notify: (event) => {
      actions.push(`${event.action}:${event.finding.pattern}`);
      const result: NotifierResult = {
        channel: 'webhook',
        ok: true,
        skipped: false,
        error: null,
        dryRunBody: null,
      };
      return Promise.resolve(result);
    },
  };
  return { notifier, actions };
}

describe('processAlertTick', () => {
  it('notifies once, suppresses inside cooldown, and resolves when clear', async () => {
    const store = createMemoryAlertStateStore();
    const { notifier, actions } = recordingNotifier();
    const lines: string[] = [];
    const rule = sampleRule();
    const context = { host: HOST, likelyCause: null, commitHints: [] };

    await processAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:00:00.000Z',
      nowMs: Date.parse('2026-10-25T12:00:00.000Z'),
      cooldownMs: HOUR,
      context,
      rules: [{ rule, findings: [TTL_DROP_FINDING] }],
      store,
      notifiers: [notifier],
      writeLine: (line) => lines.push(line),
    });

    await processAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:15:00.000Z',
      nowMs: Date.parse('2026-10-25T12:15:00.000Z'),
      cooldownMs: HOUR,
      context,
      rules: [{ rule, findings: [TTL_DROP_FINDING] }],
      store,
      notifiers: [notifier],
      writeLine: (line) => lines.push(line),
    });

    await processAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:30:00.000Z',
      nowMs: Date.parse('2026-10-25T12:30:00.000Z'),
      cooldownMs: HOUR,
      context,
      rules: [{ rule, findings: [] }],
      store,
      notifiers: [notifier],
      writeLine: (line) => lines.push(line),
    });

    expect(actions).toEqual(['firing:session:*', 'resolved:session:*']);
    expect(lines.some((line) => line.includes('alert firing'))).toBe(true);
    expect(lines.some((line) => line.includes('alert suppressed'))).toBe(true);
    expect(lines.some((line) => line.includes('alert resolved'))).toBe(true);
    const persisted = await store.load();
    expect(persisted[0]?.status).toBe('resolved');
  });

  it('does not re-fire after a restart inside the cooldown', async () => {
    const { notifier, actions } = recordingNotifier();
    const first = createMemoryAlertStateStore();
    await processAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:00:00.000Z',
      nowMs: Date.parse('2026-10-25T12:00:00.000Z'),
      cooldownMs: HOUR,
      context: { host: HOST, likelyCause: null, commitHints: [] },
      rules: [{ rule: sampleRule(), findings: [TTL_DROP_FINDING] }],
      store: first,
      notifiers: [notifier],
      writeLine: () => undefined,
    });

    const restarted = createMemoryAlertStateStore(await first.load());
    const { notifier: second, actions: afterRestart } = recordingNotifier();
    await processAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:10:00.000Z',
      nowMs: Date.parse('2026-10-25T12:10:00.000Z'),
      cooldownMs: HOUR,
      context: { host: HOST, likelyCause: null, commitHints: [] },
      rules: [{ rule: sampleRule(), findings: [TTL_DROP_FINDING] }],
      store: restarted,
      notifiers: [second],
      writeLine: () => undefined,
    });

    expect(actions).toEqual(['firing:session:*']);
    expect(afterRestart).toEqual([]);
  });

  it('swallows a notifier throw so the watch loop can continue', async () => {
    const throwing: Notifier = {
      channel: 'slack',
      notify: () => {
        throw new Error('boom');
      },
    };
    const lines: string[] = [];

    await expect(
      processAlertTick({
        host: HOST,
        occurredAt: '2026-10-25T12:00:00.000Z',
        nowMs: Date.parse('2026-10-25T12:00:00.000Z'),
        cooldownMs: HOUR,
        context: { host: HOST, likelyCause: null, commitHints: [] },
        rules: [{ rule: sampleRule(), findings: [TTL_DROP_FINDING] }],
        store: createMemoryAlertStateStore(),
        notifiers: [throwing],
        writeLine: (line) => lines.push(line),
      }),
    ).resolves.toMatchObject({ records: expect.any(Array) });

    expect(lines.join('\n')).toContain('failed');
  });
});
