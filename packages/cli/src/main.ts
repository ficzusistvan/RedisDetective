import { NotImplementedError } from '@redis-detective/core-types';
import {
  FindCandidateCommitsError,
  GitHubApiError,
  GitHubAuthConfigError,
  GitHubAuthError,
  GitHubRateLimitError,
  GitHubRepositoryRefError,
  parseRepositoryRef,
} from '@redis-detective/github-integration';
import type {
  GitHubCommitSource,
  GitHubFetch,
  GitHubRepositoryRef,
} from '@redis-detective/github-integration';
import type { LlmClient } from '@redis-detective/reasoner';

import { CLI_NAME, CLI_VERSION, HELP_TEXT } from './cli-usage.js';
import { DEFAULT_COMMIT_LOOKBACK_HOURS } from './commit-lookup-defaults.js';
import { RedisConnectionError, createRedisClient } from './create-redis-client.js';
import type { RedisConnection } from './create-redis-client.js';
import { createGitHubCommitSource } from './create-github-commit-source.js';
import type { ReadGhAuthToken } from './create-github-commit-source.js';
import { createLlmClientFromEnv } from './create-llm-client-from-env.js';
import { EXIT_CODES } from './exit-codes.js';
import type { ExitCode } from './exit-codes.js';
import { CliUsageError, parseCliArgs } from './parse-cli-args.js';
import type { CliOptions } from './parse-cli-args.js';
import { StoredSnapshotError } from './parse-stored-snapshot.js';
import { redactRedisUrl } from './redact-redis-url.js';
import { renderJsonDiagnosis } from './render-json-diagnosis.js';
import { renderJsonReport } from './render-json-report.js';
import { renderTextDiagnosis } from './render-text-diagnosis.js';
import { renderTextReport } from './render-text-report.js';
import { runDiagnosis } from './run-diagnosis.js';
import type { RunDiagnosisRequest } from './run-diagnosis.js';
import { runHealthCheck } from './run-health-check.js';
import { runWatch } from './run-watch.js';
import type { WatchDeps } from './run-watch.js';
import { createFileSnapshotStore } from './snapshot-store.js';
import type { SnapshotStore } from './snapshot-store.js';
import { DEFAULT_WATCH_INTERVAL_MS } from './watch-defaults.js';

export interface MainStreams {
  writeOut(text: string): void;
  writeError(text: string): void;
}

/** Opens a connection to the target instance. Overridden in tests. */
export type ConnectToRedis = (
  redisUrl: string,
  connectTimeoutMs: number,
) => Promise<RedisConnection>;

/** Opens the snapshot directory. Overridden in tests with an in-memory store. */
export type OpenSnapshotStore = (directory: string) => SnapshotStore;

/**
 * Builds the GitHub read surface for a repository. Overridden in tests with a fake so the command
 * never reaches the network. Production authenticates via GitHub App (preferred) or personal
 * token / `gh` fallback.
 */
export type CreateCommitSource = (repository: GitHubRepositoryRef) => Promise<GitHubCommitSource>;

export interface MainContext {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly streams: MainStreams;
  readonly now: () => Date;
  /**
   * Injected so the whole command can be exercised against a fake instance. Without this seam a
   * `main` test would have to open a real socket, and no unit test in this repo may reach the
   * network.
   */
  readonly connect?: ConnectToRedis;
  /**
   * Injected so diagnosis can be exercised without touching the filesystem. Production uses a
   * directory of JSON files.
   */
  readonly openSnapshotStore?: OpenSnapshotStore;
  /**
   * Injected so diagnosis can be exercised without GitHub credentials or a live API. Production
   * uses App credentials when complete, otherwise `gh` / `GITHUB_TOKEN` / `GH_TOKEN`.
   */
  readonly createCommitSource?: CreateCommitSource;
  /**
   * Injected so personal-token discovery never shells out to `gh` in tests. Production defaults
   * to `gh auth token`.
   */
  readonly readGhAuthToken?: ReadGhAuthToken;
  /**
   * Injected so a diagnosis can authenticate to GitHub without reaching the network.
   * Production uses `globalThis.fetch`.
   */
  readonly githubFetch?: GitHubFetch;
  /**
   * Injected so diagnosis can be exercised without a language-model provider. Production
   * constructs one from `LLM_API_KEY` when set.
   */
  readonly llmClient?: LlmClient;
  /**
   * Aborted when the user interrupts the process. Only `watch` consults it; without one, `watch`
   * samples until the process is killed. `bin.ts` is the only place that maps a signal onto this.
   */
  readonly stopSignal?: AbortSignal;
  /** Injected so `watch` can be exercised without real timers. Production waits on the clock. */
  readonly watchDeps?: WatchDeps;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

function resolvedLlmClient(context: MainContext): LlmClient | null {
  if (context.llmClient !== undefined) {
    return context.llmClient;
  }
  return createLlmClientFromEnv(context.env, (url, init) => globalThis.fetch(url, init));
}

/**
 * The CLI entry point, as a plain function returning an exit code.
 *
 * Deliberately does not call `process.exit` and does not touch `process.argv` or `process.env`
 * directly — `bin.ts` supplies those. That keeps the whole command testable in-process.
 */
export async function main(context: MainContext): Promise<ExitCode> {
  const { streams } = context;

  let options: CliOptions;
  try {
    options = parseCliArgs(context.argv, context.env);
  } catch (error) {
    if (error instanceof CliUsageError) {
      streams.writeError(`${error.message}\n`);
      return EXIT_CODES.usageError;
    }
    throw error;
  }

  if (options.help) {
    streams.writeOut(HELP_TEXT);
    return EXIT_CODES.ok;
  }

  if (options.version) {
    streams.writeOut(`${CLI_NAME} ${CLI_VERSION}\n`);
    return EXIT_CODES.ok;
  }

  if (options.command === 'watch') {
    return runWatchCommand(context, options);
  }

  if (options.intervalMs !== null) {
    streams.writeError(
      `--interval requires the watch subcommand: ${CLI_NAME} watch --url redis://host:port --snapshots <dir>.\nRun ${CLI_NAME} --help for usage.\n`,
    );
    return EXIT_CODES.usageError;
  }

  const snapshotDirectory = options.snapshotDirectory;
  const wantsDiagnosis = snapshotDirectory !== null;

  if (options.repository !== null && !wantsDiagnosis) {
    streams.writeError(
      `--repo requires --snapshots so there is a growth window to search.\nRun ${CLI_NAME} --help for usage.\n`,
    );
    return EXIT_CODES.usageError;
  }

  if (options.lookbackHours !== null && options.repository === null) {
    streams.writeError(`--lookback-hours requires --repo.\nRun ${CLI_NAME} --help for usage.\n`);
    return EXIT_CODES.usageError;
  }

  if (options.redisUrl === null && !wantsDiagnosis) {
    streams.writeError(
      `No Redis URL supplied. Pass --url redis://host:port or set REDIS_URL.\nRun ${CLI_NAME} --help for usage.\n`,
    );
    return EXIT_CODES.usageError;
  }

  if (wantsDiagnosis) {
    return runDiagnosisCommand(context, options, snapshotDirectory);
  }

  if (options.redisUrl === null) {
    streams.writeError(
      `No Redis URL supplied. Pass --url redis://host:port or set REDIS_URL.\nRun ${CLI_NAME} --help for usage.\n`,
    );
    return EXIT_CODES.usageError;
  }

  return runHealthCheckCommand(context, options, options.redisUrl);
}

async function runHealthCheckCommand(
  context: MainContext,
  options: CliOptions,
  redisUrl: string,
): Promise<ExitCode> {
  const { streams } = context;
  const target = redactRedisUrl(redisUrl);
  const connected = await openConnection(context, redisUrl, target);
  if (connected.ok === false) {
    return connected.exitCode;
  }

  try {
    const report = await runHealthCheck({
      client: connected.connection.client,
      target,
      sampleSize: options.sampleSize,
      timeoutMs: options.timeoutMs,
      memorySamples: options.memorySamples,
      databases: options.databases,
      redactKeys: options.redactKeys,
      generatedAt: context.now().toISOString(),
    });

    streams.writeOut(options.json ? renderJsonReport(report) : renderTextReport(report));
    return EXIT_CODES.ok;
  } catch (error) {
    return reportCaughtError(streams, error);
  } finally {
    await connected.connection.close();
  }
}

/**
 * `watch`: keep sampling into a snapshot directory until interrupted.
 *
 * Both requirements are hard rather than defaulted. Without `--snapshots` every sample would be
 * discarded, which is the one thing watching is for; without `--url` there is nothing to sample,
 * and an offline watch would print the same stored series forever. `--json` is refused rather than
 * ignored, because a caller piping JSON would otherwise silently receive prose.
 */
async function runWatchCommand(context: MainContext, options: CliOptions): Promise<ExitCode> {
  const { streams } = context;
  const snapshotDirectory = options.snapshotDirectory;

  if (snapshotDirectory === null) {
    streams.writeError(
      `watch requires --snapshots <dir> to accumulate samples in.\nRun ${CLI_NAME} --help for usage.\n`,
    );
    return EXIT_CODES.usageError;
  }
  if (options.redisUrl === null) {
    streams.writeError(
      `watch needs a live instance to sample. Pass --url redis://host:port or set REDIS_URL.\nRun ${CLI_NAME} --help for usage.\n`,
    );
    return EXIT_CODES.usageError;
  }
  if (options.json) {
    streams.writeError(
      `watch prints one line per sample, so --json does not apply. Run ${CLI_NAME} --snapshots ${snapshotDirectory} --json for a machine-readable diagnosis.\n`,
    );
    return EXIT_CODES.usageError;
  }

  const openStore = context.openSnapshotStore ?? createFileSnapshotStore;
  const target = redactRedisUrl(options.redisUrl);
  const connected = await openConnection(context, options.redisUrl, target);
  if (connected.ok === false) {
    return connected.exitCode;
  }

  try {
    await runWatch(
      {
        store: openStore(snapshotDirectory),
        client: connected.connection.client,
        target,
        intervalMs: options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS,
        sampleSize: options.sampleSize,
        timeoutMs: options.timeoutMs,
        memorySamples: options.memorySamples,
        databases: options.databases,
        redactKeys: options.redactKeys,
        repository: options.repository,
        now: context.now,
        stopSignal: context.stopSignal ?? new AbortController().signal,
        writeLine: (line) => {
          streams.writeOut(`${line}\n`);
        },
      },
      context.watchDeps,
    );
    return EXIT_CODES.ok;
  } catch (error) {
    return reportCaughtError(streams, error);
  } finally {
    await connected.connection.close();
  }
}

async function runDiagnosisCommand(
  context: MainContext,
  options: CliOptions,
  snapshotDirectory: string,
): Promise<ExitCode> {
  const openStore = context.openSnapshotStore ?? createFileSnapshotStore;
  const store = openStore(snapshotDirectory);
  const redisUrl = options.redisUrl;
  const target = redisUrl === null ? null : redactRedisUrl(redisUrl);

  const repositoryResult = await resolveRepository(context, options);
  if (repositoryResult.ok === false) {
    return repositoryResult.exitCode;
  }

  const llmClient = resolvedLlmClient(context);

  const request: RunDiagnosisRequest = {
    store,
    generatedAt: context.now().toISOString(),
    target,
    sampleSize: options.sampleSize,
    timeoutMs: options.timeoutMs,
    memorySamples: options.memorySamples,
    databases: options.databases,
    redactKeys: options.redactKeys,
    repository: repositoryResult.repository,
    lookbackMs: (options.lookbackHours ?? DEFAULT_COMMIT_LOOKBACK_HOURS) * 60 * 60 * 1_000,
    ...(repositoryResult.createCommitSource === undefined
      ? {}
      : { createCommitSource: repositoryResult.createCommitSource }),
    ...(llmClient === null ? {} : { llmClient }),
  };

  if (redisUrl === null) {
    return writeDiagnosis(context, options, request);
  }

  const connected = await openConnection(context, redisUrl, target ?? redisUrl);
  if (connected.ok === false) {
    return connected.exitCode;
  }

  try {
    return await writeDiagnosis(context, options, {
      ...request,
      client: connected.connection.client,
    });
  } finally {
    await connected.connection.close();
  }
}

type ResolvedRepository =
  | {
      readonly ok: true;
      readonly repository: GitHubRepositoryRef | null;
      /** Lazily builds the commit source; runDiagnosis calls this only when ≥2 snapshots exist. */
      readonly createCommitSource?: () => Promise<GitHubCommitSource>;
    }
  | { readonly ok: false; readonly exitCode: ExitCode };

function writeGitHubFailureStderr(streams: MainStreams, error: unknown, skipGh: boolean): void {
  if (error instanceof GitHubAuthConfigError) {
    const where = skipGh
      ? 'Credentials are read from the environment (including a .env file in this directory or a parent). `gh auth token` is not consulted because --skip-gh is set.'
      : 'Credentials are read from the environment (including a .env file in this directory or a parent), or from `gh auth token`.';
    streams.writeError(
      `${error.message}\n${where} See README for App setup and the solo fallback.\n`,
    );
    return;
  }
  if (
    error instanceof GitHubAuthError ||
    error instanceof GitHubRateLimitError ||
    error instanceof GitHubApiError ||
    error instanceof FindCandidateCommitsError
  ) {
    streams.writeError(`${error.message}\n`);
  }
}

async function resolveRepository(
  context: MainContext,
  options: CliOptions,
): Promise<ResolvedRepository> {
  if (options.repository === null) {
    return { ok: true, repository: null };
  }

  let repository: GitHubRepositoryRef;
  try {
    repository = parseRepositoryRef(options.repository);
  } catch (error) {
    if (error instanceof GitHubRepositoryRefError) {
      context.streams.writeError(`${error.message}\n`);
      return { ok: false, exitCode: EXIT_CODES.usageError };
    }
    throw error;
  }

  const create =
    context.createCommitSource ??
    ((repo: GitHubRepositoryRef) =>
      createGitHubCommitSource({
        env: context.env,
        repository: repo,
        now: context.now,
        fetchImpl: context.githubFetch ?? ((url, init) => globalThis.fetch(url, init)),
        ...(context.readGhAuthToken === undefined
          ? {}
          : { readGhAuthToken: context.readGhAuthToken }),
        ...(options.skipGh ? { skipGh: true } : {}),
      }));

  return {
    ok: true,
    repository,
    createCommitSource: async () => {
      try {
        return await create(repository);
      } catch (error) {
        writeGitHubFailureStderr(context.streams, error, options.skipGh);
        throw error;
      }
    },
  };
}

async function writeDiagnosis(
  context: MainContext,
  options: CliOptions,
  request: RunDiagnosisRequest,
): Promise<ExitCode> {
  const { streams } = context;
  try {
    const report = await runDiagnosis(request);
    streams.writeOut(options.json ? renderJsonDiagnosis(report) : renderTextDiagnosis(report));
    if (report.graph.gaps.some((gap) => gap.kind === 'github-unavailable')) {
      return EXIT_CODES.githubError;
    }
    return EXIT_CODES.ok;
  } catch (error) {
    return reportCaughtError(streams, error);
  }
}

type OpenedConnection =
  | { readonly ok: true; readonly connection: RedisConnection }
  | { readonly ok: false; readonly exitCode: ExitCode };

async function openConnection(
  context: MainContext,
  redisUrl: string,
  target: string,
): Promise<OpenedConnection> {
  const connect = context.connect ?? createRedisClient;

  try {
    return { ok: true, connection: await connect(redisUrl, DEFAULT_CONNECT_TIMEOUT_MS) };
  } catch (error) {
    if (error instanceof NotImplementedError) {
      return { ok: false, exitCode: reportNotImplemented(context.streams, error) };
    }
    if (error instanceof RedisConnectionError) {
      context.streams.writeError(`Could not connect to ${target}: ${error.message}\n`);
      return { ok: false, exitCode: EXIT_CODES.connectionError };
    }
    throw error;
  }
}

function reportCaughtError(streams: MainStreams, error: unknown): ExitCode {
  if (error instanceof NotImplementedError) {
    return reportNotImplemented(streams, error);
  }
  if (error instanceof StoredSnapshotError) {
    streams.writeError(`${error.message}\n`);
    return EXIT_CODES.snapshotError;
  }
  if (error instanceof GitHubAuthConfigError) {
    streams.writeError(
      `${error.message}\nCredentials are read from the environment (including a .env file in this directory or a parent), or from \`gh auth token\`. See README for App setup and the solo fallback.\n`,
    );
    return EXIT_CODES.usageError;
  }
  if (error instanceof GitHubRepositoryRefError) {
    streams.writeError(`${error.message}\n`);
    return EXIT_CODES.usageError;
  }
  if (
    error instanceof GitHubAuthError ||
    error instanceof GitHubRateLimitError ||
    error instanceof GitHubApiError ||
    error instanceof FindCandidateCommitsError
  ) {
    streams.writeError(`${error.message}\n`);
    return EXIT_CODES.githubError;
  }
  throw error;
}

/**
 * Scaffolding lands here. Reports the specific missing piece and exits with a dedicated code, so
 * "not built yet" is never mistaken for "your Redis is fine".
 */
function reportNotImplemented(streams: MainStreams, error: NotImplementedError): ExitCode {
  streams.writeError(
    `${error.message}\nRedis Detective is still scaffolding: ${error.feature} has no implementation yet.\nSee docs/mvp-scope.md for the build order.\n`,
  );
  return EXIT_CODES.notImplemented;
}
