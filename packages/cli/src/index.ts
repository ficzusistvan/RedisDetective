export { CLI_NAME, CLI_VERSION, HELP_TEXT } from './cli-usage.js';
export { readCliVersion } from './read-cli-version.js';

export { EXIT_CODES } from './exit-codes.js';
export type { ExitCode } from './exit-codes.js';

export { CLI_OUTPUT_FORMATS, isCliOutputFormat } from './output-format.js';
export type { CliOutputFormat } from './output-format.js';

export { CliUsageError, parseCliArgs } from './parse-cli-args.js';
export type { CliOptions } from './parse-cli-args.js';

export { commandFromArgv } from './command-from-argv.js';
export type { CliCommand, ParsedCommand } from './command-from-argv.js';

export { loadDotenv } from './load-dotenv.js';
export type { LoadDotenvRequest } from './load-dotenv.js';

export { redactRedisUrl } from './redact-redis-url.js';
export { REDACTED_KEY, redactExampleKeys } from './redact-example-keys.js';
export { omitExampleKeySentence } from './omit-example-keys.js';

export {
  formatBytes,
  formatCount,
  formatDuration,
  formatEstimatedBytes,
  formatPercent,
} from './format-bytes.js';

export { RedisConnectionError } from './redis-connection-error.js';
export { createRedisClient } from './create-redis-client.js';
export type { RedisConnection } from './create-redis-client.js';

export { HEALTH_FINDING_KINDS } from './health-check-report.js';
export type { HealthCheckReport, HealthFinding, HealthFindingKind } from './health-check-report.js';

export type { DiagnosisReport } from '@redis-detective/core';

export {
  DEFAULT_COMMIT_LOOKBACK_HOURS,
  DEFAULT_MAX_COMMIT_CANDIDATES,
} from './commit-lookup-defaults.js';

export { patternHintsFromGraph } from './pattern-hints-from-graph.js';
export { withNoRepositoryGap } from '@redis-detective/core';
export { withGitHubUnavailableGap } from '@redis-detective/core';
export { shouldNudgeRepositoryConnection } from '@redis-detective/core';
export {
  createGitHubCommitSource,
  resolvePersonalGitHubToken,
} from './create-github-commit-source.js';
export type {
  CreateGitHubCommitSourceRequest,
  ReadGhAuthToken,
} from './create-github-commit-source.js';
export { createAuthenticatedGitHubCommitSource } from './create-authenticated-github-commit-source.js';
export type { CreateAuthenticatedGitHubCommitSourceRequest } from './create-authenticated-github-commit-source.js';

export { createLlmClientFromEnv } from './create-llm-client-from-env.js';

export { EVIDENCE_VOCABULARY, STRENGTH_LABEL } from './evidence-vocabulary.js';
export type { EvidencePhrase } from './evidence-vocabulary.js';

export { SNAPSHOT_FILE_SCHEMA_VERSION, parseStoredSnapshot } from '@redis-detective/core';
export { StoredSnapshotError } from '@redis-detective/core';

export {
  createFileSnapshotStore,
  createMemorySnapshotStore,
  snapshotFileName,
} from './snapshot-store.js';
export type { SnapshotStore, StoredSnapshot } from './snapshot-store.js';

export { collectSamplingWarnings } from './collect-sampling-warnings.js';

export { serializeSnapshot } from '@redis-detective/core';
export { captureSnapshot, samplerOptionsFromCli } from './capture-snapshot.js';
export type { CaptureSnapshotRequest } from './capture-snapshot.js';

export { gradeFindingStrength, measuredFindingStrength } from '@redis-detective/core';
export type { FindingStrengthInput } from '@redis-detective/core';

export { HEALTH_CHECK_THRESHOLDS, deriveHealthFindings } from './derive-health-findings.js';

export { runHealthCheck } from './run-health-check.js';
export type { RunHealthCheckRequest } from './run-health-check.js';

export { runDiagnosis } from './run-diagnosis.js';
export type { RunDiagnosisRequest } from './run-diagnosis.js';

export { toHealthCheckJson } from './health-check-json.js';
export type { HealthCheckJson, HealthCheckJsonFinding } from './health-check-json.js';

export { toDiagnosisJson } from '@redis-detective/core';
export type {
  DiagnosisJson,
  DiagnosisJsonAnomaly,
  DiagnosisJsonAttribution,
  DiagnosisJsonCommitCandidate,
  DiagnosisJsonExplanation,
  DiagnosisJsonGraph,
  DiagnosisJsonTtlDrift,
} from '@redis-detective/core';

export { runLibraryHealthCheck } from './run-library-health-check.js';
export type {
  HealthCheckOptions,
  HealthCheckOptions as LibraryHealthCheckOptions,
} from './health-check-options.js';

export { saveLibrarySnapshot } from './save-library-snapshot.js';
export type {
  SaveSnapshotOptions,
  SaveSnapshotOptions as LibrarySaveSnapshotOptions,
  SavedSnapshot,
} from './save-snapshot-options.js';

export { loadLibrarySnapshots } from './load-library-snapshots.js';
export type { LoadedSnapshot } from './loaded-snapshot.js';

export { runLibraryDiagnosis } from './run-library-diagnosis.js';
export type {
  DiagnosisOptions,
  DiagnosisOptions as LibraryDiagnosisOptions,
} from './diagnosis-options.js';
export type { LibraryLlmOptions } from './library-llm-options.js';

export type { LibrarySamplingOptions } from './library-sampling-options.js';
export type { LibraryEngineDeps } from './library-engine-deps.js';

export { DEFAULT_WATCH_INTERVAL_MS, MIN_WATCH_INTERVAL_MS } from './watch-defaults.js';
export { DEFAULT_WATCH_DEPS, runWatch } from './run-watch.js';
export type { RunWatchRequest, WatchDeps, WatchSummary } from './run-watch.js';
export { formatWatchTick } from './format-watch-tick.js';
export type { WatchTick } from './format-watch-tick.js';

export { DEFAULT_PUSH_MAX_AGE_MS, DEFAULT_PUSH_MAX_BYTES } from './push-defaults.js';
export { estimateMultipartBodyBytes } from './estimate-upload-bytes.js';
export { packSnapshotBatches } from './pack-snapshot-batches.js';
export type { PackedSnapshotBatches } from './pack-snapshot-batches.js';
export {
  pushCandidateFromSnapshot,
  pushCandidatesFromStore,
  pushSnapshotsToWeb,
  uploadFilesFromSnapshotStore,
  uploadFilesFromStore,
} from './push-snapshots.js';
export type {
  FetchLike,
  PushCandidate,
  PushResult,
  PushTarget,
  SnapshotUploadFile,
} from './push-snapshots.js';
export {
  PUSH_STATE_SCHEMA_VERSION,
  PushStateError,
  createFilePushStateStore,
  createMemoryPushStateStore,
  emptyPushState,
  parsePushState,
} from './push-state-store.js';
export type {
  AcceptedSnapshot,
  PushState,
  PushStateStore,
  PushTargetRecord,
} from './push-state-store.js';
export { runSnapshotPush } from './run-snapshot-push.js';
export type { RunSnapshotPushRequest, SnapshotPushReport } from './run-snapshot-push.js';

export { evaluateAlertRules } from './evaluate-alert-rules.js';
export { formatWatchAlertBanner } from './format-watch-alert-banner.js';
export { resolveAlertConfig } from './resolve-alert-config.js';
export type {
  ResolveAlertConfigRequest,
  ResolvedAlertConfigWithPath,
} from './resolve-alert-config.js';
export { runTestAlert } from './run-test-alert.js';
export type { RunTestAlertRequest, RunTestAlertResult } from './run-test-alert.js';

export { renderTextReport } from './render-text-report.js';
export { renderMarkdownReport } from './render-markdown-report.js';
export { JSON_REPORT_SCHEMA_VERSION, renderJsonReport } from './render-json-report.js';
export { renderTextDiagnosis } from './render-text-diagnosis.js';
export { renderMarkdownDiagnosis, renderGateMarkdown } from './render-markdown-diagnosis.js';
export {
  DIAGNOSIS_REPORT_SCHEMA_VERSION,
  DIAGNOSIS_REPORT_TYPE,
  renderJsonDiagnosis,
} from './render-json-diagnosis.js';

export {
  CI_GATE_FINDING_KINDS,
  CI_GATE_MIN_SAMPLED_KEYS,
  CI_GATE_NEAR_ZERO_TTL_COVERAGE,
  CI_GATE_OUTCOMES,
  emptyCiGateThresholds,
  evaluateCiGate,
  hasCiGateThresholds,
} from '@redis-detective/core';
export type {
  CiGateFinding,
  CiGateFindingKind,
  CiGateOutcome,
  CiGateResult,
  CiGateThresholds,
  EvaluateCiGateRequest,
} from '@redis-detective/core';
export { serializeCiGate } from '@redis-detective/core';
export {
  formatCiGateFindingDetail,
  formatCiGateFindingRule,
  formatCiGateOutcome,
  formatCiGateOutcomeValue,
} from './format-ci-gate-finding.js';

export { main } from './main.js';
export type {
  ConnectToRedis,
  CreateCommitSource,
  MainContext,
  MainStreams,
  OpenSnapshotStore,
} from './main.js';
