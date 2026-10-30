/**
 * Published programmatic API for `redis-detective`.
 *
 * Deliberately small. Callers get a health check, snapshot save/load, and growth diagnosis —
 * the same JSON objects the CLI prints under `--json`. Internals (CLI parsing, `.env`, watch,
 * alerts, CI gate) stay out of this surface so they can change without freezing a library
 * contract.
 *
 * This module does not load `.env`, does not read `LLM_API_KEY`, and does not write to stdout.
 */

export { GitHubRepositoryRefError } from '@redis-detective/github-integration';

export { RedisConnectionError } from './create-redis-client.js';
export { StoredSnapshotError } from './parse-stored-snapshot.js';

export { JSON_REPORT_SCHEMA_VERSION } from './health-check-json.js';
export type { HealthCheckJson, HealthCheckJsonFinding } from './health-check-json.js';

export { DIAGNOSIS_REPORT_SCHEMA_VERSION, DIAGNOSIS_REPORT_TYPE } from './diagnosis-json.js';
export type {
  DiagnosisJson,
  DiagnosisJsonAnomaly,
  DiagnosisJsonAttribution,
  DiagnosisJsonCommitCandidate,
  DiagnosisJsonExplanation,
  DiagnosisJsonGraph,
  DiagnosisJsonTtlDrift,
} from './diagnosis-json.js';

export { runLibraryHealthCheck as runHealthCheck } from './run-library-health-check.js';
export type { LibraryHealthCheckOptions as HealthCheckOptions } from './run-library-health-check.js';

export { saveLibrarySnapshot as saveSnapshot } from './save-library-snapshot.js';
export type {
  LibrarySaveSnapshotOptions as SaveSnapshotOptions,
  SavedSnapshot,
} from './save-library-snapshot.js';

export { loadLibrarySnapshots as loadSnapshots } from './load-library-snapshots.js';
export type { LoadedSnapshot } from './load-library-snapshots.js';

export { runLibraryDiagnosis as runDiagnosis } from './run-library-diagnosis.js';
export type {
  LibraryDiagnosisOptions as DiagnosisOptions,
  LibraryLlmOptions,
} from './run-library-diagnosis.js';

export type { LibrarySamplingOptions } from './library-sampling-options.js';
