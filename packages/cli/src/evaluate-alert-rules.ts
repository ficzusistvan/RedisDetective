import type { EvaluatedAlertRule } from '@redis-detective/alerts';
import type { RedisSnapshot } from '@redis-detective/core-types';

import { evaluateCiGate } from './evaluate-ci-gate.js';
import type { AlertRule } from '@redis-detective/alerts';

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
