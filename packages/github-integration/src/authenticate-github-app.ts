import type { GitHubAppCredentials } from './github-app-credentials.js';
import { createGitHubAppJwt } from './create-github-app-jwt.js';
import type { GitHubHttp } from './github-http.js';
import { GitHubApiError } from './github-http.js';
import type { GitHubRepositoryRef } from './github-repository-ref.js';
import { formatRepositoryRef } from './github-repository-ref.js';

/**
 * A short-lived installation token. GitHub expires these after roughly an hour, which is the
 * point: nothing long-lived is ever stored, so there is no credential to leak later.
 */
export interface GitHubInstallationToken {
  readonly token: string;
  /** ISO-8601 UTC. Callers must re-authenticate rather than retry on 401. */
  readonly expiresAt: string;
  readonly repository: GitHubRepositoryRef;
}

export class GitHubAuthError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'GitHubAuthError';
  }
}

export interface AuthenticateGitHubAppDeps {
  readonly http: GitHubHttp;
  /** Injected so JWT `iat`/`exp` are reproducible in tests. */
  readonly now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTokenResponse(json: unknown): { token: string; expiresAt: string } {
  if (!isRecord(json)) {
    throw new GitHubAuthError('GitHub returned an installation token response that was not an object.');
  }
  const token = json['token'];
  const expiresAt = json['expires_at'];
  if (typeof token !== 'string' || token === '' || typeof expiresAt !== 'string' || expiresAt === '') {
    throw new GitHubAuthError(
      'GitHub returned an installation token response missing token or expires_at.',
    );
  }
  return { token, expiresAt };
}

/**
 * Exchanges App credentials for an installation token scoped to one repository.
 *
 * Signs a short-lived RS256 JWT (`iss` = app id, `exp` ≤ 10 minutes, `iat` skewed backwards so
 * GitHub does not reject a slightly-fast clock), then
 * `POST /app/installations/{installation_id}/access_tokens` with `contents: read` and
 * `pull_requests: read` only. The installation already decides which repositories the App can
 * see; listing them again in the token request is how GitHub 422s ("not accessible to the
 * parent installation") when the name does not match the installation's view of the repo.
 *
 * The JWT and the token are memory-only. They are never logged, never persisted, and never placed
 * in an error message. Callers must re-authenticate on 401 rather than retry with a stale token.
 */
export async function authenticateGitHubApp(
  credentials: GitHubAppCredentials,
  repository: GitHubRepositoryRef,
  deps: AuthenticateGitHubAppDeps,
): Promise<GitHubInstallationToken> {
  const now = deps.now ?? (() => new Date());
  const jwt = createGitHubAppJwt(credentials.privateKeyPem, credentials.appId, now());

  let response;
  try {
    response = await deps.http.request({
      method: 'POST',
      path: `/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
      authorization: `Bearer ${jwt}`,
      body: {
        permissions: {
          contents: 'read',
          pull_requests: 'read',
        },
      },
    });
  } catch (error) {
    if (error instanceof GitHubApiError) {
      throw new GitHubAuthError(installationTokenFailure(repository, error), { cause: error });
    }
    throw error;
  }

  const { token, expiresAt } = readTokenResponse(response.json);
  return { token, expiresAt, repository };
}

function installationTokenFailure(
  repository: GitHubRepositoryRef,
  error: GitHubApiError,
): string {
  const parts = [
    `Could not create a GitHub App installation token for ${formatRepositoryRef(repository)} (HTTP ${error.status}).`,
  ];
  if (error.githubMessage !== null) {
    parts.push(error.githubMessage);
  }
  if (error.status === 404 || error.status === 422) {
    parts.push(
      'Install the GitHub App on that repository and grant it Contents: Read and Pull requests: Read.',
    );
  }
  return parts.join(' ');
}
