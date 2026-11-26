import type { AlertContext, AlertStateRecord, EvaluatedAlertRule, RedisSnapshot } from '@redis-detective/core';
import { evaluateAlertTick, reduceAlertTick } from '@redis-detective/core';
import type { AlertRule } from '@redis-detective/core';

import { dispatchAlertEvent, notifiedChannelsOf } from './dispatch-alert-event.js';
import { formatAlertLine } from './format-alert-line.js';
import type { Notifier } from './notifier.js';
import type { AlertStateStore } from './alert-state-store.js';

export interface ProcessAlertTickRequest {
  readonly host: string;
  readonly occurredAt: string;
  readonly nowMs: number;
  readonly cooldownMs: number;
  readonly context: AlertContext;
  readonly store: AlertStateStore;
  readonly notifiers: readonly Notifier[];
  readonly writeLine: (line: string) => void;
  /**
   * Prefer `rules` + `snapshots` (CI-gate evaluation in core). `evaluatedRules` remains for
   * unit tests that inject findings without building snapshots.
   */
  readonly rules?: readonly AlertRule[];
  readonly snapshots?: readonly RedisSnapshot[];
  readonly evaluatedRules?: readonly EvaluatedAlertRule[];
}

export interface ProcessAlertTickResult {
  readonly lines: readonly string[];
  readonly records: readonly AlertStateRecord[];
}

/**
 * Compare this tick's findings to persisted state, notify, and save.
 *
 * Decision math lives in `@redis-detective/core` (`evaluateAlertTick` / `reduceAlertTick`).
 * This wrapper owns load/save/dispatch only.
 *
 * Load/save/notify failures are reported as lines and never thrown, so a broken webhook
 * or a locked state file cannot stop `watch` from sampling.
 */
export async function processAlertTick(
  request: ProcessAlertTickRequest,
): Promise<ProcessAlertTickResult> {
  const lines: string[] = [];
  let previousRecords: readonly AlertStateRecord[];
  try {
    previousRecords = await request.store.load();
  } catch (error) {
    lines.push(
      `alert state could not be read from ${request.store.describe}; starting empty so a corrupt file cannot re-page. ${errorMessage(error)}`,
    );
    previousRecords = [];
  }

  const decided =
    request.evaluatedRules !== undefined
      ? reduceAlertTick({
          host: request.host,
          occurredAt: request.occurredAt,
          nowMs: request.nowMs,
          cooldownMs: request.cooldownMs,
          context: request.context,
          rules: request.evaluatedRules,
          previous: previousRecords,
        })
      : evaluateAlertTick({
          host: request.host,
          occurredAt: request.occurredAt,
          nowMs: request.nowMs,
          cooldownMs: request.cooldownMs,
          context: request.context,
          rules: request.rules ?? [],
          snapshots: request.snapshots ?? [],
          previous: previousRecords,
        });

  const nextRecords = new Map(
    decided.nextState.map((record) => [record.fingerprint, record] as const),
  );

  for (const decision of decided.events) {
    if (decision.event === null) {
      const stateOnly = decision.stateOnlyResolve;
      if (stateOnly !== undefined) {
        lines.push(
          `alert resolved  ${stateOnly.pattern}  ${stateOnly.kind}  (state only; rule no longer configured)`,
        );
      }
      continue;
    }

    const event = decision.event;
    const results =
      decision.transition === 'notify-firing' ||
      decision.transition === 'renotify' ||
      decision.transition === 'notify-resolved'
        ? await dispatchAlertEvent(event, request.notifiers)
        : [];

    const current = nextRecords.get(event.fingerprint);
    if (current !== undefined && results.length > 0) {
      nextRecords.set(event.fingerprint, {
        ...current,
        notifiedChannels: uniqueChannels([
          ...current.notifiedChannels,
          ...notifiedChannelsOf(results),
        ]),
      });
    }

    const line = formatAlertLine(decision.transition, event, results);
    if (line !== null) {
      lines.push(line);
    }
    for (const result of results) {
      if (result.dryRunBody !== null) {
        lines.push(`--- alert dry-run ${result.channel} ---`);
        lines.push(result.dryRunBody);
      }
      if (result.error !== null && !result.ok) {
        lines.push(`alert ${result.channel} failed: ${result.error}`);
      }
    }
  }

  const records = [...nextRecords.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
  try {
    await request.store.save(records);
  } catch (error) {
    lines.push(
      `alert state could not be saved to ${request.store.describe}; the next tick may re-notify. ${errorMessage(error)}`,
    );
  }

  for (const line of lines) {
    request.writeLine(line);
  }
  return { lines, records };
}

function uniqueChannels(
  channels: readonly AlertStateRecord['notifiedChannels'][number][],
): readonly AlertStateRecord['notifiedChannels'][number][] {
  return [...new Set(channels)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
