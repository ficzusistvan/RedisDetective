import type { AlertFinding, AlertRule } from '@redis-detective/alerts';

export const TTL_DROP_FINDING: AlertFinding = {
  kind: 'ttl-coverage-drop',
  pattern: 'session:*',
  ttlCoverageBefore: 0.96,
  ttlCoverageAfter: 0.04,
  dropPoints: 92,
  thresholdPoints: 20,
};

export const GROWTH_FINDING: AlertFinding = {
  kind: 'pattern-growth',
  pattern: 'cache:page:*',
  bytesBefore: 10_000_000,
  bytesAfter: 20_000_000,
  bytesGrowth: 10_000_000,
  percentGrowth: 100,
  growthPercentThreshold: 25,
  growthBytesThreshold: 1_000_000,
};

export function sampleRule(overrides: Partial<AlertRule> = {}): AlertRule {
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
