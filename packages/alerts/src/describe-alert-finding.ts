import type { AlertFinding } from './alert-finding.js';
import { formatAlertBytes, formatAlertPercent, formatAlertPoints } from './format-alert-bytes.js';

export function describeAlertFindingKind(finding: AlertFinding): string {
  switch (finding.kind) {
    case 'pattern-growth':
      return 'pattern memory growth';
    case 'ttl-coverage-drop':
      return 'TTL coverage drop';
    case 'new-untimed-pattern':
      return 'new pattern without TTL';
  }
}

/**
 * Operator-facing one-liner. Patterns only — never example keys.
 */
export function describeAlertFinding(finding: AlertFinding): string {
  switch (finding.kind) {
    case 'pattern-growth': {
      const percent =
        finding.percentGrowth === null ? 'n/a' : `${finding.percentGrowth.toFixed(1)}%`;
      return `${formatAlertBytes(finding.bytesBefore)} → ${formatAlertBytes(finding.bytesAfter)} (${formatAlertBytes(finding.bytesGrowth)}, ${percent})`;
    }
    case 'ttl-coverage-drop':
      return `${formatAlertPercent(finding.ttlCoverageBefore)} → ${formatAlertPercent(finding.ttlCoverageAfter)} (drop ${formatAlertPoints(finding.dropPoints)})`;
    case 'new-untimed-pattern':
      return `new pattern with TTL ${formatAlertPercent(finding.ttlCoverageAfter)}, ${formatAlertBytes(finding.estimatedBytes)}`;
  }
}
