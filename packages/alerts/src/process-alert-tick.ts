import type { AlertContext } from './alert-context.js';
import { buildAlertEvent } from './build-alert-event.js';
import { dispatchAlertEvent, notifiedChannelsOf } from './dispatch-alert-event.js';
import type { AlertFinding } from './alert-finding.js';
import { formatAlertLine } from './format-alert-line.js';
import type { Notifier } from './notifier.js';
import type { EvaluatedAlertRule } from './alert-rule.js';
import type { AlertStateRecord } from './alert-state-record.js';
import type { AlertStateStore } from './alert-state-store.js';
import { transitionAlertState } from './transition-alert-state.js';

export interface ProcessAlertTickRequest {
  readonly host: string;
  readonly occurredAt: string;
  readonly nowMs: number;
  readonly cooldownMs: number;
  readonly context: AlertContext;
  readonly rules: readonly EvaluatedAlertRule[];
  readonly store: AlertStateStore;
  readonly notifiers: readonly Notifier[];
  readonly writeLine: (line: string) => void;
}

export interface ProcessAlertTickResult {
  readonly lines: readonly string[];
  readonly records: readonly AlertStateRecord[];
}

/**
 * Compare this tick's findings to persisted state, notify, and save.
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

  const byFingerprint = new Map(previousRecords.map((record) => [record.fingerprint, record]));
  const seen = new Set<string>();
  const nextRecords = new Map(byFingerprint);

  for (const evaluated of request.rules) {
    for (const finding of evaluated.findings) {
      const event = buildAlertEvent(
        'firing',
        request.occurredAt,
        request.host,
        evaluated.rule,
        finding,
        request.context,
      );
      seen.add(event.fingerprint);
      const decision = transitionAlertState({
        previous: byFingerprint.get(event.fingerprint) ?? null,
        firing: true,
        nowMs: request.nowMs,
        cooldownMs: request.cooldownMs,
        occurredAt: request.occurredAt,
        template: {
          fingerprint: event.fingerprint,
          dedupKey: event.dedupKey,
          host: request.host,
          pattern: finding.pattern,
          ruleId: evaluated.rule.id,
          kind: finding.kind,
          lastFinding: finding,
        },
      });

      const results =
        decision.transition === 'notify-firing' || decision.transition === 'renotify'
          ? await dispatchAlertEvent(event, request.notifiers)
          : [];
      if (decision.next !== null) {
        const notified =
          results.length === 0
            ? decision.next.notifiedChannels
            : uniqueChannels([...decision.next.notifiedChannels, ...notifiedChannelsOf(results)]);
        nextRecords.set(event.fingerprint, { ...decision.next, notifiedChannels: notified });
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
  }

  for (const record of previousRecords) {
    if (record.status !== 'firing' || seen.has(record.fingerprint)) {
      continue;
    }
    const finding = record.lastFinding ?? syntheticFindingFromRecord(record);
    const rule = request.rules.find((entry) => entry.rule.id === record.ruleId)?.rule;
    if (rule === undefined || finding === null) {
      nextRecords.set(record.fingerprint, {
        ...record,
        status: 'resolved',
        lastResolvedAt: request.occurredAt,
      });
      lines.push(
        `alert resolved  ${record.pattern}  ${record.kind}  (state only; rule no longer configured)`,
      );
      continue;
    }
    const event = buildAlertEvent(
      'resolved',
      request.occurredAt,
      request.host,
      rule,
      finding,
      request.context,
    );
    const decision = transitionAlertState({
      previous: record,
      firing: false,
      nowMs: request.nowMs,
      cooldownMs: request.cooldownMs,
      occurredAt: request.occurredAt,
      template: {
        fingerprint: record.fingerprint,
        dedupKey: record.dedupKey,
        host: record.host,
        pattern: record.pattern,
        ruleId: record.ruleId,
        kind: record.kind,
      },
    });
    const results =
      decision.transition === 'notify-resolved'
        ? await dispatchAlertEvent(event, request.notifiers)
        : [];
    if (decision.next !== null) {
      nextRecords.set(record.fingerprint, decision.next);
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

function syntheticFindingFromRecord(record: AlertStateRecord): AlertFinding | null {
  switch (record.kind) {
    case 'pattern-growth':
      return {
        kind: 'pattern-growth',
        pattern: record.pattern,
        bytesBefore: 0,
        bytesAfter: 0,
        bytesGrowth: 0,
        percentGrowth: null,
        growthPercentThreshold: null,
        growthBytesThreshold: null,
      };
    case 'ttl-coverage-drop':
      return {
        kind: 'ttl-coverage-drop',
        pattern: record.pattern,
        ttlCoverageBefore: 0,
        ttlCoverageAfter: 0,
        dropPoints: 0,
        thresholdPoints: 0,
      };
    case 'new-untimed-pattern':
      return {
        kind: 'new-untimed-pattern',
        pattern: record.pattern,
        ttlCoverageAfter: 0,
        estimatedBytes: 0,
        estimatedKeyCount: 0,
      };
    default:
      return null;
  }
}

function uniqueChannels(
  channels: readonly AlertStateRecord['notifiedChannels'][number][],
): readonly AlertStateRecord['notifiedChannels'][number][] {
  return [...new Set(channels)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
