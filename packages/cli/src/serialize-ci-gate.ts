import type { CiGateFinding, CiGateResult } from './evaluate-ci-gate.js';

/**
 * The JSON shape of a CI gate result. Field-by-field so a new internal field cannot leak.
 */
export function serializeCiGate(gate: CiGateResult): unknown {
  return {
    outcome: gate.outcome,
    warnOnly: gate.warnOnly,
    comparedSnapshotCount: gate.comparedSnapshotCount,
    baselineSnapshotId: gate.baselineSnapshotId,
    currentSnapshotId: gate.currentSnapshotId,
    findings: gate.findings.map(serializeFinding),
    notes: gate.notes,
  };
}

function serializeFinding(finding: CiGateFinding): unknown {
  switch (finding.kind) {
    case 'pattern-growth':
      return {
        kind: finding.kind,
        pattern: finding.pattern,
        bytesBefore: finding.bytesBefore,
        bytesAfter: finding.bytesAfter,
        bytesGrowth: finding.bytesGrowth,
        percentGrowth: finding.percentGrowth,
        growthPercentThreshold: finding.growthPercentThreshold,
        growthBytesThreshold: finding.growthBytesThreshold,
      };
    case 'ttl-coverage-drop':
      return {
        kind: finding.kind,
        pattern: finding.pattern,
        ttlCoverageBefore: finding.ttlCoverageBefore,
        ttlCoverageAfter: finding.ttlCoverageAfter,
        dropPoints: finding.dropPoints,
        thresholdPoints: finding.thresholdPoints,
      };
    case 'new-untimed-pattern':
      return {
        kind: finding.kind,
        pattern: finding.pattern,
        ttlCoverageAfter: finding.ttlCoverageAfter,
        estimatedBytes: finding.estimatedBytes,
        estimatedKeyCount: finding.estimatedKeyCount,
      };
  }
}
