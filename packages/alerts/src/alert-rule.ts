import type { AlertChannel } from './alert-channel.js';
import type { AlertFinding, AlertFindingKind } from './alert-finding.js';
import type { AlertSeverity } from './alert-severity.js';

/**
 * Thresholds for one named rule. `null` / `false` means that comparison is off.
 *
 * These are the same numbers `evaluateCiGate` already understands. The CLI passes them
 * through; this package never compares snapshots itself.
 */
export interface AlertRuleThresholds {
  readonly growthPercent: number | null;
  readonly growthBytes: number | null;
  readonly ttlDropPoints: number | null;
  readonly newUntimedPatterns: boolean;
}

export interface AlertRule {
  readonly id: string;
  readonly severity: AlertSeverity;
  /** Empty means "every configured channel that accepts this severity". */
  readonly channels: readonly AlertChannel[];
  readonly thresholds: AlertRuleThresholds;
}

export interface EvaluatedAlertRule {
  readonly rule: AlertRule;
  readonly findings: readonly AlertFinding[];
}

export function ruleAppliesToChannel(rule: AlertRule, channel: AlertChannel): boolean {
  return rule.channels.length === 0 || rule.channels.includes(channel);
}

export function findingIdentity(ruleId: string, kind: AlertFindingKind, pattern: string): string {
  return `${ruleId}\0${kind}\0${pattern}`;
}
