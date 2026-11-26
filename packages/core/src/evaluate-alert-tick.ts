import type { RedisSnapshot } from '@redis-detective/core-types';

import type { AlertContext } from './alert-context.js';
import { buildAlertEvent } from './build-alert-event.js';
import type { AlertEvent } from './alert-event.js';
import type { AlertFinding, AlertFindingKind } from './alert-finding.js';
import type { AlertRule, EvaluatedAlertRule } from './alert-rule.js';
import type { AlertStateRecord, AlertStateTransition } from './alert-state-record.js';
import { evaluateAlertRules } from './evaluate-alert-rules.js';
import { transitionAlertState } from './transition-alert-state.js';

export interface EvaluateAlertTickInput {
  readonly host: string;
  /** ISO timestamp; caller-supplied. */
  readonly occurredAt: string;
  /** Caller-supplied wall clock; do not use `Date.now()` inside core. */
  readonly nowMs: number;
  readonly cooldownMs: number;
  readonly context: AlertContext;
  readonly rules: readonly AlertRule[];
  readonly snapshots: readonly RedisSnapshot[];
  readonly previous: readonly AlertStateRecord[];
}

/**
 * One decision from the pure tick: a transition plus an event when a payload would be built.
 *
 * `event` is null only for a state-only resolve when the rule was removed from config (no
 * channel notify). Suppress still carries an event so callers can log the cooldown line.
 */
export interface AlertTickDecision {
  readonly transition: AlertStateTransition;
  readonly event: AlertEvent | null;
  /** Present when `event` is null (rule removed while still firing). */
  readonly stateOnlyResolve?: {
    readonly fingerprint: string;
    readonly pattern: string;
    readonly kind: AlertFindingKind;
  };
}

export interface EvaluateAlertTickResult {
  readonly nextState: readonly AlertStateRecord[];
  readonly events: readonly AlertTickDecision[];
}

/**
 * Pure alert tick: compare CI-gate findings to prior state and decide notify / suppress / resolve.
 *
 * Does not load or save a store, and does not dispatch notifiers. Empty gate findings mean
 * resolve-or-idle — this function never invents findings.
 */
export function evaluateAlertTick(input: EvaluateAlertTickInput): EvaluateAlertTickResult {
  return reduceAlertTick({
    host: input.host,
    occurredAt: input.occurredAt,
    nowMs: input.nowMs,
    cooldownMs: input.cooldownMs,
    context: input.context,
    rules: evaluateAlertRules(input.snapshots, input.rules),
    previous: input.previous,
  });
}

/**
 * Same state machine as `evaluateAlertTick`, when findings are already computed.
 *
 * Kept for unit tests that inject gate findings without building snapshots, and for thin I/O
 * wrappers that evaluated rules before calling in.
 */
export function reduceAlertTick(input: {
  readonly host: string;
  readonly occurredAt: string;
  readonly nowMs: number;
  readonly cooldownMs: number;
  readonly context: AlertContext;
  readonly rules: readonly EvaluatedAlertRule[];
  readonly previous: readonly AlertStateRecord[];
}): EvaluateAlertTickResult {
  const byFingerprint = new Map(input.previous.map((record) => [record.fingerprint, record]));
  const seen = new Set<string>();
  const nextRecords = new Map(byFingerprint);
  const events: AlertTickDecision[] = [];

  for (const evaluated of input.rules) {
    for (const finding of evaluated.findings) {
      const event = buildAlertEvent(
        'firing',
        input.occurredAt,
        input.host,
        evaluated.rule,
        finding,
        input.context,
      );
      seen.add(event.fingerprint);
      const decision = transitionAlertState({
        previous: byFingerprint.get(event.fingerprint) ?? null,
        firing: true,
        nowMs: input.nowMs,
        cooldownMs: input.cooldownMs,
        occurredAt: input.occurredAt,
        template: {
          fingerprint: event.fingerprint,
          dedupKey: event.dedupKey,
          host: input.host,
          pattern: finding.pattern,
          ruleId: evaluated.rule.id,
          kind: finding.kind,
          lastFinding: finding,
        },
      });

      if (decision.next !== null) {
        nextRecords.set(event.fingerprint, decision.next);
      }
      if (decision.transition !== 'none') {
        events.push({ transition: decision.transition, event });
      }
    }
  }

  for (const record of input.previous) {
    if (record.status !== 'firing' || seen.has(record.fingerprint)) {
      continue;
    }
    const finding = record.lastFinding ?? syntheticFindingFromRecord(record);
    const rule = input.rules.find((entry) => entry.rule.id === record.ruleId)?.rule;
    if (rule === undefined || finding === null) {
      nextRecords.set(record.fingerprint, {
        ...record,
        status: 'resolved',
        lastResolvedAt: input.occurredAt,
      });
      events.push({
        transition: 'notify-resolved',
        event: null,
        stateOnlyResolve: {
          fingerprint: record.fingerprint,
          pattern: record.pattern,
          kind: record.kind,
        },
      });
      continue;
    }
    const event = buildAlertEvent(
      'resolved',
      input.occurredAt,
      input.host,
      rule,
      finding,
      input.context,
    );
    const decision = transitionAlertState({
      previous: record,
      firing: false,
      nowMs: input.nowMs,
      cooldownMs: input.cooldownMs,
      occurredAt: input.occurredAt,
      template: {
        fingerprint: record.fingerprint,
        dedupKey: record.dedupKey,
        host: record.host,
        pattern: record.pattern,
        ruleId: record.ruleId,
        kind: record.kind,
      },
    });
    if (decision.next !== null) {
      nextRecords.set(record.fingerprint, decision.next);
    }
    if (decision.transition !== 'none') {
      events.push({ transition: decision.transition, event });
    }
  }

  const nextState = [...nextRecords.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
  return { nextState, events };
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
