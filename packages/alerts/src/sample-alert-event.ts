import type { AlertContext } from './alert-context.js';
import { DEFAULT_ALERT_SEVERITY } from './alert-defaults.js';
import { buildAlertEvent } from './build-alert-event.js';
import type { AlertEvent } from './alert-event.js';
import type { AlertRule } from './alert-rule.js';
import type { AlertSeverity } from './alert-severity.js';

const SAMPLE_OCCURRED_AT = '2026-10-25T12:00:00.000Z';

/**
 * Synthetic firing event for `test-alert`. Patterns only; no example keys, no live host
 * credentials. Numbers are illustrative, not measured.
 */
export function sampleAlertEvent(
  host: string,
  context: AlertContext = emptySampleContext(host),
  severity: AlertSeverity = DEFAULT_ALERT_SEVERITY,
): AlertEvent {
  const rule: AlertRule = {
    id: 'test',
    severity,
    channels: [],
    thresholds: {
      growthPercent: null,
      growthBytes: null,
      ttlDropPoints: 20,
      newUntimedPatterns: false,
    },
  };
  return buildAlertEvent(
    'firing',
    SAMPLE_OCCURRED_AT,
    host,
    rule,
    {
      kind: 'ttl-coverage-drop',
      pattern: 'session:*',
      ttlCoverageBefore: 0.96,
      ttlCoverageAfter: 0.04,
      dropPoints: 92,
      thresholdPoints: 20,
    },
    context,
  );
}

export function emptySampleContext(host: string): AlertContext {
  return {
    host,
    likelyCause: {
      pattern: 'session:*',
      description:
        'TTL coverage collapsed on this pattern (sample notification; not a live finding).',
    },
    commitHints: [],
  };
}
