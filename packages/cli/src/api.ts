/**
 * Published programmatic API for `redis-detective`.
 *
 * Deliberately small. Callers get a health check, snapshot save/load, and growth diagnosis —
 * the same JSON objects the CLI prints under `--json`. Internals (CLI parsing, `.env`, watch,
 * alerts, CI gate) stay out of this surface so they can change without freezing a library
 * contract.
 *
 * This module does not load `.env`, does not read `LLM_API_KEY`, and does not write to stdout.
 * Wrappers here take options only: test-only `deps` seams on the `runLibrary*` functions are
 * not part of the published signatures.
 */

import { GitHubRepositoryRefError } from '@redis-detective/github-integration';

import type {
  DiagnosisJson,
  DiagnosisJsonAnomaly,
  DiagnosisJsonAttribution,
  DiagnosisJsonCommitCandidate,
  DiagnosisJsonExplanation,
  DiagnosisJsonGraph,
  DiagnosisJsonTtlDrift,
} from './diagnosis-json.js';
import { DIAGNOSIS_REPORT_SCHEMA_VERSION, DIAGNOSIS_REPORT_TYPE } from './diagnosis-json.js';
import type { DiagnosisOptions } from './diagnosis-options.js';
import type { HealthCheckJson, HealthCheckJsonFinding } from './health-check-json.js';
import { JSON_REPORT_SCHEMA_VERSION } from './health-check-json.js';
import type { HealthCheckOptions } from './health-check-options.js';
import type { LibraryLlmOptions } from './library-llm-options.js';
import type { LibrarySamplingOptions } from './library-sampling-options.js';
import type { LoadedSnapshot } from './loaded-snapshot.js';
import { loadLibrarySnapshots } from './load-library-snapshots.js';
import { RedisConnectionError } from './redis-connection-error.js';
import { runLibraryDiagnosis } from './run-library-diagnosis.js';
import { runLibraryHealthCheck } from './run-library-health-check.js';
import type { SaveSnapshotOptions, SavedSnapshot } from './save-snapshot-options.js';
import { saveLibrarySnapshot } from './save-library-snapshot.js';
import { StoredSnapshotError } from './stored-snapshot-error.js';

export {
  DIAGNOSIS_REPORT_SCHEMA_VERSION,
  DIAGNOSIS_REPORT_TYPE,
  GitHubRepositoryRefError,
  JSON_REPORT_SCHEMA_VERSION,
  RedisConnectionError,
  StoredSnapshotError,
};

export type {
  DiagnosisJson,
  DiagnosisJsonAnomaly,
  DiagnosisJsonAttribution,
  DiagnosisJsonCommitCandidate,
  DiagnosisJsonExplanation,
  DiagnosisJsonGraph,
  DiagnosisJsonTtlDrift,
  DiagnosisOptions,
  HealthCheckJson,
  HealthCheckJsonFinding,
  HealthCheckOptions,
  LibraryLlmOptions,
  LibrarySamplingOptions,
  LoadedSnapshot,
  SaveSnapshotOptions,
  SavedSnapshot,
};

export async function runHealthCheck(options: HealthCheckOptions): Promise<HealthCheckJson> {
  return runLibraryHealthCheck(options);
}

export async function saveSnapshot(options: SaveSnapshotOptions): Promise<SavedSnapshot> {
  return saveLibrarySnapshot(options);
}

export async function loadSnapshots(directory: string): Promise<readonly LoadedSnapshot[]> {
  return loadLibrarySnapshots(directory);
}

export async function runDiagnosis(options: DiagnosisOptions): Promise<DiagnosisJson> {
  return runLibraryDiagnosis(options);
}
