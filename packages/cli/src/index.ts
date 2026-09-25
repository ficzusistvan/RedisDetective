export { CLI_NAME, CLI_VERSION, HELP_TEXT } from './cli-usage.js';
export { readCliVersion } from './read-cli-version.js';

export { EXIT_CODES } from './exit-codes.js';
export type { ExitCode } from './exit-codes.js';

export { CliUsageError, parseCliArgs } from './parse-cli-args.js';
export type { CliOptions } from './parse-cli-args.js';

export { commandFromArgv } from './command-from-argv.js';
export type { CliCommand, ParsedCommand } from './command-from-argv.js';

export { loadDotenv } from './load-dotenv.js';
export type { LoadDotenvRequest } from './load-dotenv.js';

export { redactRedisUrl } from './redact-redis-url.js';
export { REDACTED_KEY, redactExampleKeys } from './redact-example-keys.js';

export {
  formatBytes,
  formatCount,
  formatDuration,
  formatEstimatedBytes,
  formatPercent,
} from './format-bytes.js';

export { RedisConnectionError, createRedisClient } from './create-redis-client.js';
export type { RedisConnection } from './create-redis-client.js';

export { HEALTH_FINDING_KINDS } from './health-check-report.js';
export type { HealthCheckReport, HealthFinding, HealthFindingKind } from './health-check-report.js';

export type { DiagnosisReport } from './diagnosis-report.js';

export {
  DEFAULT_COMMIT_LOOKBACK_HOURS,
  DEFAULT_MAX_COMMIT_CANDIDATES,
} from './commit-lookup-defaults.js';

export { patternHintsFromGraph } from './pattern-hints-from-graph.js';
export { withNoRepositoryGap } from './with-no-repository-gap.js';
export { withGitHubUnavailableGap } from './with-github-unavailable-gap.js';
export { shouldNudgeRepositoryConnection } from './should-nudge-repository-connection.js';
export { createAuthenticatedGitHubCommitSource } from './create-authenticated-github-commit-source.js';
export type { CreateAuthenticatedGitHubCommitSourceRequest } from './create-authenticated-github-commit-source.js';

export { createLlmClientFromEnv } from './create-llm-client-from-env.js';

export { EVIDENCE_VOCABULARY, STRENGTH_LABEL } from './evidence-vocabulary.js';
export type { EvidencePhrase } from './evidence-vocabulary.js';

export {
  SNAPSHOT_FILE_SCHEMA_VERSION,
  StoredSnapshotError,
  parseStoredSnapshot,
} from './parse-stored-snapshot.js';

export {
  createFileSnapshotStore,
  createMemorySnapshotStore,
  snapshotFileName,
} from './snapshot-store.js';
export type { SnapshotStore, StoredSnapshot } from './snapshot-store.js';

export { collectSamplingWarnings } from './collect-sampling-warnings.js';

export { serializeSnapshot } from './serialize-snapshot.js';
export { captureSnapshot, samplerOptionsFromCli } from './capture-snapshot.js';
export type { CaptureSnapshotRequest } from './capture-snapshot.js';

export { gradeFindingStrength, measuredFindingStrength } from './grade-finding-strength.js';
export type { FindingStrengthInput } from './grade-finding-strength.js';

export { HEALTH_CHECK_THRESHOLDS, deriveHealthFindings } from './derive-health-findings.js';

export { runHealthCheck } from './run-health-check.js';
export type { RunHealthCheckRequest } from './run-health-check.js';

export { runDiagnosis } from './run-diagnosis.js';
export type { RunDiagnosisRequest } from './run-diagnosis.js';

export { DEFAULT_WATCH_INTERVAL_MS, MIN_WATCH_INTERVAL_MS } from './watch-defaults.js';
export { DEFAULT_WATCH_DEPS, runWatch } from './run-watch.js';
export type { RunWatchRequest, WatchDeps, WatchSummary } from './run-watch.js';
export { formatWatchTick } from './format-watch-tick.js';
export type { WatchTick } from './format-watch-tick.js';

export { renderTextReport } from './render-text-report.js';
export { JSON_REPORT_SCHEMA_VERSION, renderJsonReport } from './render-json-report.js';
export { renderTextDiagnosis } from './render-text-diagnosis.js';
export {
  DIAGNOSIS_REPORT_SCHEMA_VERSION,
  DIAGNOSIS_REPORT_TYPE,
  renderJsonDiagnosis,
} from './render-json-diagnosis.js';

export { main } from './main.js';
export type {
  ConnectToRedis,
  CreateCommitSource,
  MainContext,
  MainStreams,
  OpenSnapshotStore,
} from './main.js';
