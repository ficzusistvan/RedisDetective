import { ALERT_PAYLOAD_SCHEMA_VERSION } from './alert-defaults.js';
import type { AlertEvent } from './alert-event.js';
import type { AlertFinding } from './alert-finding.js';
import type { AlertWebhookPayload } from './alert-payload.js';
import { describeAlertFindingKind } from './describe-alert-finding.js';

export function buildAlertPayload(event: AlertEvent): AlertWebhookPayload {
  return {
    schemaVersion: ALERT_PAYLOAD_SCHEMA_VERSION,
    event: event.action,
    occurredAt: event.occurredAt,
    host: event.context.host,
    pattern: event.finding.pattern,
    dedupKey: event.dedupKey,
    rule: {
      id: event.rule.id,
      kind: event.finding.kind,
      severity: event.rule.severity,
    },
    change: changeFromFinding(event.finding),
    likelyCause:
      event.context.likelyCause === null
        ? null
        : {
            pattern: event.context.likelyCause.pattern,
            description: event.context.likelyCause.description,
          },
    commitHints: event.context.commitHints.map((hint) => ({
      sha: hint.sha,
      shortSha: hint.shortSha,
      message: hint.message,
    })),
  };
}

function changeFromFinding(finding: AlertFinding): AlertWebhookPayload['change'] {
  const summary = describeAlertFindingKind(finding);
  switch (finding.kind) {
    case 'pattern-growth':
      return {
        summary,
        growthBytes: finding.bytesGrowth,
        growthPercent: finding.percentGrowth,
        ttlCoverageBefore: null,
        ttlCoverageAfter: null,
      };
    case 'ttl-coverage-drop':
      return {
        summary,
        growthBytes: null,
        growthPercent: null,
        ttlCoverageBefore: finding.ttlCoverageBefore,
        ttlCoverageAfter: finding.ttlCoverageAfter,
      };
    case 'new-untimed-pattern':
      return {
        summary,
        growthBytes: finding.estimatedBytes,
        growthPercent: null,
        ttlCoverageBefore: null,
        ttlCoverageAfter: finding.ttlCoverageAfter,
      };
  }
}
