import type { GitHubCommitSource, RawCommit, RawPullRequest } from './github-commit-source.js';
import type { GitHubHttp } from './github-http.js';
import type { GitHubRepositoryRef } from './github-repository-ref.js';

export interface CreateGitHubRestCommitSourceOptions {
  readonly http: GitHubHttp;
  readonly token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function repoPath(repository: GitHubRepositoryRef): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}

function parseCommit(value: unknown): RawCommit | null {
  if (!isRecord(value)) {
    return null;
  }

  const sha = readString(value['sha']);
  const url = readString(value['html_url']);
  const commit = isRecord(value['commit']) ? value['commit'] : null;
  if (sha === null || url === null || commit === null) {
    return null;
  }

  const message = readString(commit['message']) ?? '';
  const committer = isRecord(commit['committer']) ? commit['committer'] : null;
  const authorBlock = isRecord(commit['author']) ? commit['author'] : null;
  const committedAt = readString(committer?.['date']) ?? readString(authorBlock?.['date']);
  if (committedAt === null) {
    return null;
  }

  const githubAuthor = isRecord(value['author']) ? value['author'] : null;
  const files = asArray(value['files']);
  const changedPaths = files
    .map((file) => (isRecord(file) ? readString(file['filename']) : null))
    .filter((name): name is string => name !== null);

  return {
    sha,
    message,
    authorName: readString(authorBlock?.['name']) ?? 'unknown',
    authorEmail: readString(authorBlock?.['email']),
    authorLogin: readString(githubAuthor?.['login']),
    committedAt,
    url,
    changedPaths,
  };
}

function parsePullRequest(value: unknown): RawPullRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const number = value['number'];
  const title = readString(value['title']);
  const url = readString(value['html_url']);
  if (typeof number !== 'number' || !Number.isInteger(number) || title === null || url === null) {
    return null;
  }

  const mergedAtRaw = value['merged_at'];
  const mergeCommitShaRaw = value['merge_commit_sha'];

  return {
    number,
    title,
    url,
    mergedAt: typeof mergedAtRaw === 'string' ? mergedAtRaw : null,
    mergeCommitSha: typeof mergeCommitShaRaw === 'string' ? mergeCommitShaRaw : null,
  };
}

async function getJson(
  http: GitHubHttp,
  token: string,
  path: string,
  accept?: string,
): Promise<{ json: unknown; nextPath: string | null }> {
  const response = await http.request({
    method: 'GET',
    path,
    authorization: `Bearer ${token}`,
    ...(accept === undefined ? {} : { accept }),
  });
  return { json: response.json, nextPath: response.nextPath };
}

/**
 * A `GitHubCommitSource` over the GitHub REST API.
 *
 * Read-only by construction: it only issues GET. Changed paths are not on the list-commits
 * payload, so each commit is followed by a GET of that commit. That is N extra requests, which is
 * why `maxResults` is a hard cap rather than "whatever GitHub returns".
 */
export function createGitHubRestCommitSource(
  options: CreateGitHubRestCommitSourceOptions,
): GitHubCommitSource {
  const { http, token } = options;

  return {
    async listCommits(request): Promise<readonly RawCommit[]> {
      const collected: RawCommit[] = [];
      const params = new URLSearchParams({
        since: request.window.from,
        until: request.window.to,
        per_page: String(Math.min(100, Math.max(1, request.maxResults))),
      });
      let path: string | null = `${repoPath(request.repository)}/commits?${params.toString()}`;

      while (path !== null && collected.length < request.maxResults) {
        const page = await getJson(http, token, path);
        const rows = asArray(page.json);
        for (const row of rows) {
          if (collected.length >= request.maxResults) {
            break;
          }
          const summary = parseCommit(row);
          if (summary === null) {
            continue;
          }
          // List payload has no files. One extra GET per commit, capped by maxResults.
          const detail = await getJson(http, token, `${repoPath(request.repository)}/commits/${summary.sha}`);
          const full = parseCommit(detail.json) ?? summary;
          collected.push(full);
        }
        path = page.nextPath;
      }

      return collected;
    },

    async listPullRequestsForCommit(
      repository: GitHubRepositoryRef,
      sha: string,
    ): Promise<readonly RawPullRequest[]> {
      const page = await getJson(
        http,
        token,
        `${repoPath(repository)}/commits/${encodeURIComponent(sha)}/pulls`,
      );
      return asArray(page.json)
        .map(parsePullRequest)
        .filter((pull): pull is RawPullRequest => pull !== null);
    },
  };
}
