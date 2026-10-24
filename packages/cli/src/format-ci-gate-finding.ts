import type { CiGateFinding, CiGateOutcome, CiGateResult } from './evaluate-ci-gate.js';
import { formatCount, formatEstimatedBytes, formatPercent } from './format-bytes.js';

export function formatCiGateOutcome(gate: CiGateResult): string {
  return formatCiGateOutcomeValue(gate.outcome, gate.warnOnly);
}

export function formatCiGateOutcomeValue(outcome: CiGateOutcome, warnOnly: boolean): string {
  switch (outcome) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'warn':
      return warnOnly ? 'warn (thresholds crossed; warn-only)' : 'warn';
    case 'skipped':
      return 'skipped (not enough snapshots to compare)';
  }
}

export function formatCiGateFindingRule(finding: CiGateFinding): string {
  switch (finding.kind) {
    case 'pattern-growth':
      return 'pattern memory growth';
    case 'ttl-coverage-drop':
      return 'TTL coverage drop';
    case 'new-untimed-pattern':
      return 'new pattern without TTL';
  }
}

export function formatCiGateFindingDetail(finding: CiGateFinding): string {
  switch (finding.kind) {
    case 'pattern-growth': {
      const percent =
        finding.percentGrowth === null ? 'n/a' : `${finding.percentGrowth.toFixed(1)}%`;
      const percentThreshold =
        finding.growthPercentThreshold === null
          ? ''
          : `, threshold ${finding.growthPercentThreshold.toFixed(1)}%`;
      const bytesThreshold =
        finding.growthBytesThreshold === null
          ? ''
          : `, threshold ${formatEstimatedBytes(finding.growthBytesThreshold, true)}`;
      return `${formatEstimatedBytes(finding.bytesBefore, true)} → ${formatEstimatedBytes(finding.bytesAfter, true)} (${formatEstimatedBytes(finding.bytesGrowth, true)}, ${percent}${percentThreshold}${bytesThreshold})`;
    }
    case 'ttl-coverage-drop':
      return `${formatPercent(finding.ttlCoverageBefore)} → ${formatPercent(finding.ttlCoverageAfter)} (drop ${finding.dropPoints.toFixed(1)} points, threshold ${finding.thresholdPoints.toFixed(1)})`;
    case 'new-untimed-pattern':
      return `new pattern with TTL ${formatPercent(finding.ttlCoverageAfter)}, ${formatCount(finding.estimatedKeyCount, true)} keys, ${formatEstimatedBytes(finding.estimatedBytes, true)}`;
  }
}
