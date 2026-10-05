export {
  EVIDENCE_DEFAULTS,
  EvidenceOptionsError,
  resolveEvidenceOptions,
} from './evidence-options.js';
export type { EvidenceOptions, ResolvedEvidenceOptions } from './evidence-options.js';

export { createEvidenceId } from './create-evidence-id.js';
export type { EvidenceIdKind } from './create-evidence-id.js';

export {
  SnapshotOrderingError,
  sortSnapshotsChronologically,
} from './sort-snapshots-chronologically.js';

export { relativeChange } from './relative-change.js';
export { ttlCoverage } from './ttl-coverage.js';
export { totalKeyCount } from './total-key-count.js';
export {
  comparableStoredBytes,
  readGrowthMetric,
  selectGrowthMetric,
} from './select-growth-metric.js';
export type { GrowthMetric } from './select-growth-metric.js';
export { describeChange } from './describe-change.js';
export type { ChangeUnit } from './describe-change.js';

export { gradeEvidenceStrength } from './grade-evidence-strength.js';
export type { EvidenceStrengthInput } from './grade-evidence-strength.js';

export { detectMemoryAnomalies } from './detect-memory-anomalies.js';
export { attributeGrowthToPatterns } from './attribute-growth-to-patterns.js';
export { detectTtlDrift } from './detect-ttl-drift.js';

export { buildEvidenceGraph } from './build-evidence-graph.js';
export type { BuildEvidenceGraphInput } from './build-evidence-graph.js';
