import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  GITHUB_PERSONAL_TOKEN_ENV_VARS,
  GitHubAuthConfigError,
  authenticateGitHubApp,
  createGitHubHttp,
  createGitHubRestCommitSource,
  isGitHubAppEnvComplete,
  loadGitHubAppCredentialsFromEnv,
} from '@redis-detective/github-integration';
import type {
  GitHubCommitSource,
  GitHubFetch,
  GitHubRepositoryRef,
} from '@redis-detective/github-integration';

const execFileAsync = promisify(execFile);

export type ReadGhAuthToken = () => Promise<string | null>;

export interface CreateGitHubCommitSourceRequest {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly repository: GitHubRepositoryRef;
  readonly now: () => Date;
  /**
   * Required. Passing `fetch` in from the caller — rather than defaulting to `globalThis.fetch` —
   * is what keeps a unit test from reaching the network by constructing this function.
   */
  readonly fetchImpl: GitHubFetch;
  /**
   * Injected so tests never shell out to `gh`. Production defaults to `gh auth token`.
   */
  readonly readGhAuthToken?: ReadGhAuthToken;
}

/**
 * Runs `gh auth token`. Returns `null` when `gh` is missing, not logged in, or the output is empty.
 * Never throws — personal auth discovery treats failure as “try the next source.”
 */
export async function defaultReadGhAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    const token = stdout.trim();
    return token === '' ? null : token;
  } catch {
    return null;
  }
}

function readEnvToken(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = env[name];
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Personal credential discovery: `gh auth token`, then `GITHUB_TOKEN`, then `GH_TOKEN`.
 * Used only when GitHub App environment is incomplete.
 */
export async function resolvePersonalGitHubToken(
  env: Readonly<Record<string, string | undefined>>,
  deps: { readonly readGhAuthToken?: ReadGhAuthToken } = {},
): Promise<string | null> {
  const readGh = deps.readGhAuthToken ?? defaultReadGhAuthToken;
  const fromGh = await readGh();
  if (fromGh !== null) {
    return fromGh;
  }
  return (
    readEnvToken(env, GITHUB_PERSONAL_TOKEN_ENV_VARS.githubToken) ??
    readEnvToken(env, GITHUB_PERSONAL_TOKEN_ENV_VARS.ghToken)
  );
}

function missingCredentialsMessage(): string {
  return [
    'No GitHub credentials available for candidate commit lookup.',
    'Preferred: configure a GitHub App (GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and a private key).',
    'Solo fallback: run `gh auth login` (uses `gh auth token`), or set GITHUB_TOKEN / GH_TOKEN.',
    'Documented minimum access: read contents and pull requests on the Connected repository.',
  ].join(' ');
}

/**
 * Builds a read-only commit source: App installation token when App env is complete, otherwise a
 * personal token from `gh` / `GITHUB_TOKEN` / `GH_TOKEN`.
 *
 * The token lives only in the returned source's closure. It is never logged, never returned, and
 * never placed in an error.
 */
export async function createGitHubCommitSource(
  request: CreateGitHubCommitSourceRequest,
): Promise<GitHubCommitSource> {
  const http = createGitHubHttp(request.fetchImpl);

  if (isGitHubAppEnvComplete(request.env)) {
    const credentials = loadGitHubAppCredentialsFromEnv(request.env);
    const installation = await authenticateGitHubApp(credentials, request.repository, {
      http,
      now: request.now,
    });
    return createGitHubRestCommitSource({ http, token: installation.token });
  }

  const token = await resolvePersonalGitHubToken(request.env, {
    ...(request.readGhAuthToken === undefined ? {} : { readGhAuthToken: request.readGhAuthToken }),
  });
  if (token === null) {
    throw new GitHubAuthConfigError(missingCredentialsMessage());
  }

  return createGitHubRestCommitSource({ http, token });
}
