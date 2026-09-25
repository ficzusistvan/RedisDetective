import type {
  GitHubCommitSource,
  GitHubFetch,
  GitHubRepositoryRef,
} from '@redis-detective/github-integration';

import {
  createGitHubCommitSource,
  defaultReadGhAuthToken,
} from './create-github-commit-source.js';
import type { ReadGhAuthToken } from './create-github-commit-source.js';

export type { ReadGhAuthToken };

export interface CreateAuthenticatedGitHubCommitSourceRequest {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly repository: GitHubRepositoryRef;
  readonly now: () => Date;
  readonly fetchImpl: GitHubFetch;
  readonly readGhAuthToken?: ReadGhAuthToken;
}

/**
 * @deprecated Prefer `createGitHubCommitSource`. Kept as a thin alias for existing imports.
 */
export async function createAuthenticatedGitHubCommitSource(
  request: CreateAuthenticatedGitHubCommitSourceRequest,
): Promise<GitHubCommitSource> {
  return createGitHubCommitSource({
    env: request.env,
    repository: request.repository,
    now: request.now,
    fetchImpl: request.fetchImpl,
    readGhAuthToken: request.readGhAuthToken ?? defaultReadGhAuthToken,
  });
}
