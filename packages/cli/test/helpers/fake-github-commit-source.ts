import type {
  GitHubCommitSource,
  RawCommit,
  RawPullRequest,
} from '@redis-detective/github-integration';

export function rawCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    message: 'stop dropping EX on cart items',
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authorLogin: 'ada',
    committedAt: '2026-08-25T09:00:00.000Z',
    url: 'https://github.com/acme/checkout/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    changedPaths: ['src/cart/items.ts'],
    ...overrides,
  };
}

export function fakeGitHubCommitSource(
  commits: readonly RawCommit[] = [],
  pulls: Readonly<Record<string, readonly RawPullRequest[]>> = {},
): GitHubCommitSource {
  return {
    listCommits: () => Promise.resolve(commits),
    listPullRequestsForCommit: (_repository, sha) => Promise.resolve(pulls[sha] ?? []),
  };
}
