import type { TimeWindow } from '@redis-detective/core-types';

import type { GitHubRepositoryRef } from './github-repository-ref.js';

/** Raw commit shape as returned by the source, before it becomes a `GitCommitCandidate`. */
export interface RawCommit {
  readonly sha: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly authorLogin: string | null;
  readonly committedAt: string;
  readonly url: string;
  readonly changedPaths: readonly string[];
}

export interface RawPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly mergedAt: string | null;
  readonly mergeCommitSha: string | null;
}

export interface ListCommitsRequest {
  readonly repository: GitHubRepositoryRef;
  readonly window: TimeWindow;
  readonly maxResults: number;
}

/**
 * The GitHub read surface this package needs, as an injectable interface.
 *
 * Split out from `findCandidateCommits` so that candidate selection — the part with actual logic in
 * it — is unit testable against a fake, with no live API, no token and no rate limit. Read-only by
 * construction: there is no method here that can write to a repository.
 */
export interface GitHubCommitSource {
  listCommits(request: ListCommitsRequest): Promise<readonly RawCommit[]>;
  listPullRequestsForCommit(
    repository: GitHubRepositoryRef,
    sha: string,
  ): Promise<readonly RawPullRequest[]>;
}
