export class GitHubApiError extends Error {
  readonly status: number;
  /** GitHub's `message` (and `errors`) from the JSON body, or `null`. Never a credential. */
  readonly githubMessage: string | null;

  constructor(
    message: string,
    status: number,
    options?: { readonly cause?: unknown; readonly githubMessage?: string | null },
  ) {
    super(message, options);
    this.name = 'GitHubApiError';
    this.status = status;
    this.githubMessage = options?.githubMessage ?? null;
  }
}

export class GitHubRateLimitError extends GitHubApiError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = 'GitHubRateLimitError';
  }
}

export interface GitHubHttpRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  /** Already-formed `Bearer …` value. Never log this. */
  readonly authorization: string;
  readonly body?: unknown;
  readonly accept?: string;
}

export interface GitHubHttpResponse {
  readonly status: number;
  readonly json: unknown;
  readonly nextPath: string | null;
  readonly rateLimitRemaining: number | null;
}

/**
 * The GitHub HTTP surface this package needs. Injected so tests never open a socket.
 *
 * `path` is API-relative (`/repos/acme/api/commits`). Implementations prepend the API host.
 */
export interface GitHubHttp {
  request(request: GitHubHttpRequest): Promise<GitHubHttpResponse>;
}

export type GitHubFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const USER_AGENT = 'redis-detective';
const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_ACCEPT = 'application/vnd.github+json';

function parseNextPath(linkHeader: string | null, apiBaseUrl: string): string | null {
  if (linkHeader === null) {
    return null;
  }

  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    const url = match?.[1];
    if (url === undefined) {
      continue;
    }
    if (url.startsWith(apiBaseUrl)) {
      return url.slice(apiBaseUrl.length);
    }
    try {
      return new URL(url).pathname + new URL(url).search;
    } catch {
      return null;
    }
  }

  return null;
}

function parseRateLimitRemaining(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeSecret(value: string): boolean {
  return /ghs_|ghp_|ghu_|gho_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+\S/i.test(value);
}

/**
 * Pulls GitHub's human-readable failure out of an error body. The full payload is not returned:
 * we only want `message` and `errors`, and anything that looks like a credential is dropped.
 */
function readGitHubErrorDetail(json: unknown): string | null {
  if (!isRecord(json)) {
    return null;
  }

  const message = json['message'];
  const parts: string[] = [];
  if (typeof message === 'string' && message !== '' && !looksLikeSecret(message)) {
    parts.push(message);
  }

  const errors = json['errors'];
  if (Array.isArray(errors)) {
    for (const error of errors) {
      if (typeof error === 'string' && error !== '' && !looksLikeSecret(error)) {
        parts.push(error);
        continue;
      }
      if (isRecord(error)) {
        const nested = error['message'];
        if (typeof nested === 'string' && nested !== '' && !looksLikeSecret(nested)) {
          parts.push(nested);
        }
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }
  return parts.join(': ');
}

/**
 * A `GitHubHttp` over `fetch`.
 *
 * `fetchImpl` is a required argument rather than defaulting to `globalThis.fetch`, so a test that
 * constructs this client cannot silently reach the network. Production (`packages/cli`) passes
 * `globalThis.fetch`.
 */
export function createGitHubHttp(fetchImpl: GitHubFetch, apiBaseUrl = DEFAULT_API_BASE): GitHubHttp {
  const base = apiBaseUrl.replace(/\/$/, '');

  return {
    async request(request: GitHubHttpRequest): Promise<GitHubHttpResponse> {
      const url = request.path.startsWith('http') ? request.path : `${base}${request.path}`;
      const headers: Record<string, string> = {
        Authorization: request.authorization,
        Accept: request.accept ?? DEFAULT_ACCEPT,
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (request.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      let response: Awaited<ReturnType<GitHubFetch>>;
      try {
        response = await fetchImpl(url, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
      } catch (error) {
        throw new GitHubApiError(
          'Could not reach GitHub. The request details are omitted so a URL cannot leak a token.',
          0,
          { cause: error },
        );
      }

      const raw = await response.text();
      let json: unknown = null;
      if (raw !== '') {
        try {
          json = JSON.parse(raw) as unknown;
        } catch (error) {
          throw new GitHubApiError(
            `GitHub returned non-JSON at HTTP ${response.status}.`,
            response.status,
            { cause: error },
          );
        }
      }

      const rateLimitRemaining = parseRateLimitRemaining(
        response.headers.get('x-ratelimit-remaining'),
      );

      if (response.status === 403 && rateLimitRemaining === 0) {
        throw new GitHubRateLimitError(
          'GitHub API rate limit exceeded. Wait and retry; this tool will not retry on its own.',
          response.status,
        );
      }
      if (response.status === 429) {
        throw new GitHubRateLimitError(
          'GitHub API rate limit exceeded. Wait and retry; this tool will not retry on its own.',
          response.status,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        const githubMessage = readGitHubErrorDetail(json);
        throw new GitHubApiError(
          githubMessage === null
            ? `GitHub API request failed with HTTP ${response.status}.`
            : `GitHub API request failed with HTTP ${response.status}: ${githubMessage}`,
          response.status,
          { githubMessage },
        );
      }

      return {
        status: response.status,
        json,
        nextPath: parseNextPath(response.headers.get('link'), base),
        rateLimitRemaining,
      };
    },
  };
}
