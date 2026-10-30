import {
  createGitHubHttp,
  createGitHubRestCommitSource,
  parseRepositoryRef,
} from '@redis-detective/github-integration';
import type { GitHubCommitSource, GitHubRepositoryRef } from '@redis-detective/github-integration';
import type { LlmClient } from '@redis-detective/reasoner';

import { DEFAULT_COMMIT_LOOKBACK_HOURS } from './commit-lookup-defaults.js';
import { createRedisClient } from './create-redis-client.js';
import type { DiagnosisJson } from './diagnosis-json.js';
import { toDiagnosisJson } from './diagnosis-json.js';
import type { DiagnosisOptions } from './diagnosis-options.js';
import type { LibraryEngineDeps } from './library-engine-deps.js';
import type { LibraryLlmOptions } from './library-llm-options.js';
import { llmClientFromLibraryOptions } from './library-llm-options.js';
import { capturedSamplingFields } from './library-sampling-options.js';
import { redactRedisUrl } from './redact-redis-url.js';
import { runDiagnosis } from './run-diagnosis.js';
import type { RunDiagnosisRequest } from './run-diagnosis.js';
import { createFileSnapshotStore } from './snapshot-store.js';
import { DEFAULT_CONNECT_TIMEOUT_MS } from './with-redis-connection.js';

export type { LibraryLlmOptions } from './library-llm-options.js';
export type { DiagnosisOptions as LibraryDiagnosisOptions } from './diagnosis-options.js';

/**
 * Diffs stored snapshots into a diagnosis, optionally sampling live Redis first.
 *
 * Returns the same object the CLI prints under `--json` (without a CI `gate` block). Does not
 * print, does not load `.env`, and does not read `LLM_API_KEY` or GitHub credentials from the
 * environment.
 */
export async function runLibraryDiagnosis(
  options: DiagnosisOptions,
  deps: LibraryEngineDeps = {},
): Promise<DiagnosisJson> {
  const generatedAt = options.generatedAt ?? (deps.now ?? (() => new Date()))().toISOString();
  const sampling = capturedSamplingFields(options);
  const url = options.url;
  const llmClient = resolveLlmClient(options.llm, deps);
  const github = resolveGitHub(options, deps);

  const request: RunDiagnosisRequest = {
    store: createFileSnapshotStore(options.directory),
    generatedAt,
    target: url === undefined ? null : redactRedisUrl(url),
    sampleSize: sampling.sampleSize,
    timeoutMs: sampling.timeoutMs,
    memorySamples: sampling.memorySamples,
    databases: sampling.databases,
    redactKeys: sampling.redactKeys,
    repository: github.repository,
    lookbackMs: (options.lookbackHours ?? DEFAULT_COMMIT_LOOKBACK_HOURS) * 60 * 60 * 1_000,
    ...(github.createCommitSource === undefined
      ? {}
      : { createCommitSource: github.createCommitSource }),
    ...(github.githubUnavailableDetail === undefined
      ? {}
      : { githubUnavailableDetail: github.githubUnavailableDetail }),
    ...(llmClient === null ? {} : { llmClient }),
  };

  if (url === undefined) {
    return toDiagnosisJson(await runDiagnosis(request));
  }

  const connect = deps.connect ?? createRedisClient;
  const connection = await connect(url, DEFAULT_CONNECT_TIMEOUT_MS);
  try {
    return toDiagnosisJson(await runDiagnosis({ ...request, client: connection.client }));
  } finally {
    await connection.close();
  }
}

function resolveLlmClient(
  llm: LibraryLlmOptions | undefined,
  deps: LibraryEngineDeps,
): LlmClient | null {
  if (llm === undefined) {
    return null;
  }
  const fetchImpl = deps.llmFetch ?? ((url, init) => globalThis.fetch(url, init));
  return llmClientFromLibraryOptions(llm, fetchImpl);
}

function resolveGitHub(
  options: DiagnosisOptions,
  deps: LibraryEngineDeps,
): {
  readonly repository: GitHubRepositoryRef | null;
  readonly createCommitSource?: () => Promise<GitHubCommitSource>;
  readonly githubUnavailableDetail?: string;
} {
  if (options.repository === undefined) {
    return { repository: null };
  }

  const repository = parseRepositoryRef(options.repository);
  const token = options.githubToken?.trim() ?? '';
  if (token === '') {
    return {
      repository,
      githubUnavailableDetail:
        'GitHub credentials were not supplied. Pass githubToken to look up candidate commits.',
    };
  }

  const fetchImpl = deps.githubFetch ?? ((url, init) => globalThis.fetch(url, init));
  return {
    repository,
    createCommitSource: () =>
      Promise.resolve(
        createGitHubRestCommitSource({
          http: createGitHubHttp(fetchImpl),
          token,
        }),
      ),
  };
}
