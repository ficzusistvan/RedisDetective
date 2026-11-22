/**
 * @redis-detective/core — side-effect-free analysis.
 *
 * Web-facing contract (also what the published package documents):
 *   types, constants, parse/serialize, diagnoseSnapshots, buildEvidenceGraph, explainEvidence,
 *   toDiagnosisJson, and the three error classes below.
 *
 * Extra re-exports exist so the workspace CLI can import analysis only from this package
 * (not from core-types / evidence / reasoner directly).
 */

export type {
  EstimateBasis,
  KeyPatternStats,
  RedisDataType,
  RedisDeploymentMode,
  RedisInstanceIdentity,
  RedisKeyspaceFacts,
  RedisMemoryFacts,
  RedisRole,
  RedisSnapshot,
  SamplingMetadata,
  EvidenceGraph,
  Explanation,
  ExplanationCause,
  ExplanationCitation,
  EvidenceKind,
  LlmAttribution,
  EvidenceGap,
  EvidenceGapKind,
  EvidenceStrength,
  AnomalyEvent,
  AnomalyKind,
  AnomalyMetric,
  PatternAttribution,
  GrowthMechanism,
  TTLDriftEvent,
  TtlDriftKind,
  GitCommitCandidate,
  GitActor,
  GitPullRequestRef,
  TemporalRelation,
  TimeWindow,
} from '@redis-detective/core-types';

export {
  REDIS_DATA_TYPES,
  EVIDENCE_STRENGTHS,
  isEvidenceStrength,
  NotImplementedError,
} from '@redis-detective/core-types';
export type { NotImplementedContext, NotImplementedContextValue } from '@redis-detective/core-types';

export {
  EVIDENCE_DEFAULTS,
  EvidenceOptionsError,
  resolveEvidenceOptions,
  buildEvidenceGraph,
  SnapshotOrderingError,
  sortSnapshotsChronologically,
  ttlCoverage,
  formatDuration,
} from '@redis-detective/evidence';
export type {
  EvidenceOptions,
  ResolvedEvidenceOptions,
  BuildEvidenceGraphInput,
} from '@redis-detective/evidence';

export { explainEvidence } from '@redis-detective/reasoner';
export type { LlmClient, ExplainEvidenceDeps } from '@redis-detective/reasoner';

export {
  SNAPSHOT_FILE_SCHEMA_VERSION,
  SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS,
  parseStoredSnapshot,
  StoredSnapshotError,
} from './parse-stored-snapshot.js';

export { serializeSnapshot } from './serialize-snapshot.js';
export { serializeSnapshotFile } from './serialize-snapshot-file.js';
export { snapshotFileName } from './snapshot-file-name.js';

export {
  DIAGNOSIS_REPORT_SCHEMA_VERSION,
  DIAGNOSIS_REPORT_TYPE,
  toDiagnosisJson,
} from './diagnosis-json.js';
export type {
  DiagnosisJson,
  DiagnosisJsonAnomaly,
  DiagnosisJsonAttribution,
  DiagnosisJsonCommitCandidate,
  DiagnosisJsonExplanation,
  DiagnosisJsonGraph,
  DiagnosisJsonTtlDrift,
} from './diagnosis-json.js';

export type { DiagnosisReport } from './diagnosis-report.js';

export { diagnoseSnapshots } from './diagnose-snapshots.js';
export type { DiagnoseSnapshotsInput } from './diagnose-snapshots.js';

export { shouldNudgeRepositoryConnection } from './should-nudge-repository-connection.js';
export { withNoRepositoryGap } from './with-no-repository-gap.js';
export { withGitHubUnavailableGap } from './with-github-unavailable-gap.js';

export {
  CI_GATE_FINDING_KINDS,
  CI_GATE_MIN_SAMPLED_KEYS,
  CI_GATE_NEAR_ZERO_TTL_COVERAGE,
  CI_GATE_OUTCOMES,
  emptyCiGateThresholds,
  evaluateCiGate,
  hasCiGateThresholds,
} from './evaluate-ci-gate.js';
export type {
  CiGateFinding,
  CiGateFindingKind,
  CiGateOutcome,
  CiGateResult,
  CiGateThresholds,
  EvaluateCiGateRequest,
} from './evaluate-ci-gate.js';

export { serializeCiGate } from './serialize-ci-gate.js';

export { gradeFindingStrength, measuredFindingStrength } from './grade-finding-strength.js';
export type { FindingStrengthInput } from './grade-finding-strength.js';
