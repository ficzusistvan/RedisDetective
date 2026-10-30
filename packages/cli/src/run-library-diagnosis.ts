import {
  createGitHubHttp,
  createGitHubRestCommitSource,
  parseRepositoryRef,
} from '@redis-detective/github-integration';
import type { GitHubCommitSource, GitHubRepositoryRef } from '@redis-detective/github-integration';
import type { LlmClient } from '@redis-detective/reasoner';

import { DEFAULT_COMMIT_LOOKBACK_HOURS } from './commit-lookup-defaults.js';
import { createRedisClient } from './create-redis-client.js';
import { toDiagnosisJson } from './diagnosis-json.js';
import type { DiagnosisJson } from './diagnosis-json.js';
import type { LibraryEngineDeps } from './library-engine-deps.js';
import type { LibraryLlmOptions } from './library-llm-options.js';
import { llmClientFromLibraryOptions } from './library-llm-options.js';
import type { LibrarySamplingOptions } from './library-sampling-options.js';
import { capturedSamplingFields } from './library-sampling-options.js';
import { redactRedisUrl } from './redact-redis-url.js';
import { runDiagnosis } from './run-diagnosis.js';
import type { RunDiagnosisRequest } from './run-diagnosis.js';
import { createFileSnapshotStore } from './snapshot-store.js';
import { DEFAULT_CONNECT_TIMEOUT_MS } from './with-redis-connection.js';

export type { LibraryLlmOptions } from './library-llm-options.js';

export interface LibraryDiagnosisOptions extends LibrarySamplingOptions {
  /** Directory of `*.snapshot.json` files — the same path `--snapshots` takes. */
  readonly directory: string;
  /**
   * When set, this run samples live Redis, saves the snapshot, then diffs. When omitted, the
   * directory is read as-is and no Redis connection is opened.
   */
  readonly url?: string;
  /** ISO-8601 UTC. Defaults to now. Pass a fixed value to make tests reproducible. */
  readonly generatedAt?: string;
  /**
   * `owner/repo` to search for candidate commits. Omit to skip GitHub entirely. The library
   * never reads `GITHUB_TOKEN` or App env vars — pass `githubToken` alongside this.
   */
  readonly repository?: string;
  /** Personal access token used only when `repository` is set. Never read from the environment. */
  readonly githubToken?: string;
  /** Hours before the growth window to search. Defaults to seven days. */
  readonly lookbackHours?: number;
  /**
   * Explicit LLM rewording. Omit for the deterministic paragraph. The library never reads
   * `LLM_API_KEY`.
   */
  readonly llm?: LibraryLlmOptions;
}

/**
 * Diffs stored snapshots into a diagnosis, optionally sampling live Redis first.
 *
 * Returns the same object the CLI prints under `--json` (without a CI `gate` block). Does not
 * print, does not load `.env`, and does not read `LLM_API_KEY` or GitHub credentials from the
 * environment.
 */
export async function runLibraryDiagnosis(
  options: LibraryDiagnosisOptions,
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
  options: LibraryDiagnosisOptions,
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
