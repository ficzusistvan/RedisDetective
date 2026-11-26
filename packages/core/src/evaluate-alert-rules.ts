import type { RedisSnapshot } from '@redis-detective/core-types';

import type { AlertRule, EvaluatedAlertRule } from './alert-rule.js';
import { evaluateCiGate } from './evaluate-ci-gate.js';

/**
 * Runs each alert rule through `evaluateCiGate`. Threshold math lives in one place.
 */
export function evaluateAlertRules(
  snapshots: readonly RedisSnapshot[],
  rules: readonly AlertRule[],
): readonly EvaluatedAlertRule[] {
  return rules.map((rule) => ({
    rule,
    findings: evaluateCiGate({
      snapshots,
      thresholds: rule.thresholds,
      warnOnly: false,
    }).findings,
  }));
}
