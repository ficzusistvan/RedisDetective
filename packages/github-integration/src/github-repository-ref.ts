export interface GitHubRepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

export class GitHubRepositoryRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubRepositoryRefError';
  }
}

const OWNER_REPO = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;

/**
 * Parses an `owner/repo` string.
 *
 * Strict on purpose: this value is interpolated into API paths, so anything that could carry a
 * path traversal or a query string must be rejected here rather than sanitised downstream.
 */
export function parseRepositoryRef(value: string): GitHubRepositoryRef {
  const match = OWNER_REPO.exec(value.trim());
  if (match === null) {
    throw new GitHubRepositoryRefError(
      `Expected a repository as "owner/repo", received "${value}".`,
    );
  }

  const [, owner, repo] = match;
  if (owner === undefined || repo === undefined) {
    throw new GitHubRepositoryRefError(`Could not parse repository "${value}".`);
  }

  return { owner, repo };
}

export function formatRepositoryRef(ref: GitHubRepositoryRef): string {
  return `${ref.owner}/${ref.repo}`;
}
