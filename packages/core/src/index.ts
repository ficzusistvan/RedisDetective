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
  ANOMALY_METRIC_PHRASE,
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

export { ALERT_CHANNELS, isAlertChannel } from './alert-channel.js';
export type { AlertChannel } from './alert-channel.js';

export { ALERT_SEVERITIES, isAlertSeverity, severityMeetsMinimum } from './alert-severity.js';
export type { AlertSeverity } from './alert-severity.js';

export { ALERT_FINDING_KINDS } from './alert-finding.js';
export type { AlertFinding, AlertFindingKind } from './alert-finding.js';

export { findingIdentity, ruleAppliesToChannel } from './alert-rule.js';
export type { AlertRule, AlertRuleThresholds, EvaluatedAlertRule } from './alert-rule.js';

export type { AlertCommitHint, AlertContext, AlertLikelyCause } from './alert-context.js';

export { ALERT_ACTIONS } from './alert-action.js';
export type { AlertAction } from './alert-action.js';

export type { AlertEvent } from './alert-event.js';

export {
  ALERT_PAYLOAD_SCHEMA_VERSION,
  ALERT_STATE_SCHEMA_VERSION,
  DEFAULT_ALERT_COOLDOWN_MS,
  DEFAULT_ALERT_SEVERITY,
  IMPLICIT_CLI_RULE_ID,
} from './alert-defaults.js';

export { alertFingerprint } from './alert-fingerprint.js';
export type { AlertIdentity } from './alert-fingerprint.js';

export { pagerdutyDedupKey } from './pagerduty-dedup-key.js';

export { ALERT_STATUSES, ALERT_STATE_TRANSITIONS } from './alert-state-record.js';
export type { AlertStateRecord, AlertStateTransition, AlertStatus } from './alert-state-record.js';

export { transitionAlertState } from './transition-alert-state.js';
export type { AlertStateDecision, TransitionAlertStateRequest } from './transition-alert-state.js';

export { buildAlertEvent } from './build-alert-event.js';

export { evaluateAlertRules } from './evaluate-alert-rules.js';

export { evaluateAlertTick, reduceAlertTick } from './evaluate-alert-tick.js';
export type {
  AlertTickDecision,
  EvaluateAlertTickInput,
  EvaluateAlertTickResult,
} from './evaluate-alert-tick.js';
