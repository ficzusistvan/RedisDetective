import { describe, expect, it } from 'vitest';

import {
  alertFingerprint,
  evaluateAlertTick,
  evaluateCiGate,
  reduceAlertTick,
} from '@redis-detective/core';
import type { AlertFinding, AlertRule, AlertStateRecord } from '@redis-detective/core';

import { leakingSnapshots } from './helpers/leaking-snapshots.js';

const HOST = 'redis://localhost:6379/';
const HOUR = 60 * 60 * 1_000;
const CONTEXT = { host: HOST, likelyCause: null, commitHints: [] } as const;

const TTL_DROP_FINDING: AlertFinding = {
  kind: 'ttl-coverage-drop',
  pattern: 'session:*',
  ttlCoverageBefore: 0.96,
  ttlCoverageAfter: 0.04,
  dropPoints: 92,
  thresholdPoints: 20,
};

function sampleRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'ttl-drop',
    severity: 'critical',
    channels: [],
    thresholds: {
      growthPercent: null,
      growthBytes: null,
      ttlDropPoints: 20,
      newUntimedPatterns: false,
    },
    ...overrides,
  };
}

function tick(
  occurredAt: string,
  findings: readonly AlertFinding[],
  previous: readonly AlertStateRecord[],
  rule: AlertRule = sampleRule(),
) {
  return reduceAlertTick({
    host: HOST,
    occurredAt,
    nowMs: Date.parse(occurredAt),
    cooldownMs: HOUR,
    context: CONTEXT,
    rules: [{ rule, findings }],
    previous,
  });
}

describe('reduceAlertTick / evaluateAlertTick', () => {
  it('notifies once, suppresses 15m later inside a 1h cooldown, then resolves when clear', () => {
    const first = tick('2026-10-25T12:00:00.000Z', [TTL_DROP_FINDING], []);
    expect(first.events.map((event) => event.transition)).toEqual(['notify-firing']);
    expect(first.events[0]?.event?.finding).toEqual(TTL_DROP_FINDING);
    expect(first.nextState[0]?.status).toBe('firing');

    const suppressed = tick(
      '2026-10-25T12:15:00.000Z',
      [TTL_DROP_FINDING],
      first.nextState,
    );
    expect(suppressed.events.map((event) => event.transition)).toEqual(['suppress']);
    expect(suppressed.events.some((event) => event.event !== null)).toBe(true);

    const resolved = tick('2026-10-25T12:30:00.000Z', [], suppressed.nextState);
    expect(resolved.events.map((event) => event.transition)).toEqual(['notify-resolved']);
    expect(resolved.events[0]?.event?.action).toBe('resolved');
    expect(resolved.nextState[0]?.status).toBe('resolved');
  });

  it('does not re-fire after a restart inside the cooldown when previous is fed back', () => {
    const first = tick('2026-10-25T12:00:00.000Z', [TTL_DROP_FINDING], []);
    const restarted = tick('2026-10-25T12:10:00.000Z', [TTL_DROP_FINDING], first.nextState);
    expect(restarted.events.map((event) => event.transition)).toEqual(['suppress']);
  });

  it('gives independent fingerprints to multiple rules / patterns', () => {
    const growth: AlertFinding = {
      kind: 'pattern-growth',
      pattern: 'cache:page:*',
      bytesBefore: 10_000_000,
      bytesAfter: 20_000_000,
      bytesGrowth: 10_000_000,
      percentGrowth: 100,
      growthPercentThreshold: 25,
      growthBytesThreshold: 1_000_000,
    };
    const ttlRule = sampleRule({ id: 'ttl' });
    const growthRule = sampleRule({
      id: 'growth',
      thresholds: {
        growthPercent: 25,
        growthBytes: 1_000_000,
        ttlDropPoints: null,
        newUntimedPatterns: false,
      },
    });

    const result = reduceAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:00:00.000Z',
      nowMs: Date.parse('2026-10-25T12:00:00.000Z'),
      cooldownMs: HOUR,
      context: CONTEXT,
      rules: [
        { rule: ttlRule, findings: [TTL_DROP_FINDING] },
        { rule: growthRule, findings: [growth] },
      ],
      previous: [],
    });

    expect(result.events).toHaveLength(2);
    const fingerprints = result.events.map((event) => event.event?.fingerprint);
    expect(new Set(fingerprints).size).toBe(2);
    expect(fingerprints[0]).toBe(
      alertFingerprint({
        host: HOST,
        pattern: 'session:*',
        ruleId: 'ttl',
        kind: 'ttl-coverage-drop',
      }),
    );
    expect(fingerprints[1]).toBe(
      alertFingerprint({
        host: HOST,
        pattern: 'cache:page:*',
        ruleId: 'growth',
        kind: 'pattern-growth',
      }),
    );
  });

  it('emits no events when findings and previous are both empty', () => {
    const result = tick('2026-10-25T12:00:00.000Z', [], []);
    expect(result.events).toEqual([]);
    expect(result.nextState).toEqual([]);
  });

  it('state-only resolves when a firing rule is removed from config', () => {
    const first = tick('2026-10-25T12:00:00.000Z', [TTL_DROP_FINDING], []);
    const afterRemoval = reduceAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:30:00.000Z',
      nowMs: Date.parse('2026-10-25T12:30:00.000Z'),
      cooldownMs: HOUR,
      context: CONTEXT,
      rules: [],
      previous: first.nextState,
    });

    expect(afterRemoval.events).toEqual([
      expect.objectContaining({
        transition: 'notify-resolved',
        event: null,
        stateOnlyResolve: {
          fingerprint: first.nextState[0]?.fingerprint,
          pattern: 'session:*',
          kind: 'ttl-coverage-drop',
        },
      }),
    ]);
    expect(afterRemoval.nextState[0]?.status).toBe('resolved');
  });

  it('evaluateAlertTick findings match evaluateCiGate for the same snapshots and thresholds', () => {
    const rule = sampleRule({
      id: 'leak',
      thresholds: {
        growthPercent: null,
        growthBytes: null,
        ttlDropPoints: 20,
        newUntimedPatterns: false,
      },
    });
    const snapshots = leakingSnapshots();
    const gate = evaluateCiGate({
      snapshots,
      thresholds: rule.thresholds,
      warnOnly: false,
    });
    const tickResult = evaluateAlertTick({
      host: HOST,
      occurredAt: '2026-10-25T12:00:00.000Z',
      nowMs: Date.parse('2026-10-25T12:00:00.000Z'),
      cooldownMs: HOUR,
      context: CONTEXT,
      rules: [rule],
      snapshots,
      previous: [],
    });

    expect(gate.findings.length).toBeGreaterThan(0);
    expect(tickResult.events.map((event) => event.event?.finding)).toEqual(gate.findings);
  });
});
