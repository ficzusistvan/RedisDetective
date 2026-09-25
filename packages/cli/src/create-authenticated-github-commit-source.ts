import {
  authenticateGitHubApp,
  createGitHubHttp,
  createGitHubRestCommitSource,
  loadGitHubAppCredentialsFromEnv,
} from '@redis-detective/github-integration';
import type {
  GitHubCommitSource,
  GitHubFetch,
  GitHubRepositoryRef,
} from '@redis-detective/github-integration';

export interface CreateAuthenticatedGitHubCommitSourceRequest {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly repository: GitHubRepositoryRef;
  readonly now: () => Date;
  /**
   * Required. Passing `fetch` in from the caller — rather than defaulting to `globalThis.fetch` —
   * is what keeps a unit test from reaching the network by constructing this function.
   */
  readonly fetchImpl: GitHubFetch;
}

/**
 * Exchanges GitHub App credentials from the environment for a read-only commit source.
 *
 * The installation token lives only in the returned source's closure. It is never logged, never
 * returned, and never placed in an error.
 */
export async function createAuthenticatedGitHubCommitSource(
  request: CreateAuthenticatedGitHubCommitSourceRequest,
): Promise<GitHubCommitSource> {
  const credentials = loadGitHubAppCredentialsFromEnv(request.env);
  const http = createGitHubHttp(request.fetchImpl);
  const installation = await authenticateGitHubApp(credentials, request.repository, {
    http,
    now: request.now,
  });
  return createGitHubRestCommitSource({ http, token: installation.token });
}
