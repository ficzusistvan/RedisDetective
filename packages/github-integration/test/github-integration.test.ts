import { createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FindCandidateCommitsError,
  GITHUB_APP_ENV_VARS,
  GitHubApiError,
  GitHubAuthConfigError,
  GitHubAuthError,
  GitHubRateLimitError,
  GitHubRepositoryRefError,
  authenticateGitHubApp,
  classifyTemporalRelation,
  createGitHubAppJwt,
  createGitHubHttp,
  createGitHubRestCommitSource,
  findCandidateCommits,
  formatRepositoryRef,
  loadGitHubAppCredentialsFromEnv,
  matchPatternHints,
  parseRepositoryRef,
} from '@redis-detective/github-integration';
import type {
  GitHubCommitSource,
  GitHubHttp,
  GitHubHttpRequest,
  GitHubHttpResponse,
  RawCommit,
} from '@redis-detective/github-integration';

const REPO = { owner: 'acme', repo: 'checkout' };
const WINDOW = { from: '2026-08-25T10:00:00.000Z', to: '2026-08-25T12:00:00.000Z' };

function rawCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    message: 'fix session expiry',
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authorLogin: 'ada',
    committedAt: '2026-08-25T09:00:00.000Z',
    url: 'https://github.com/acme/checkout/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    changedPaths: ['src/session/store.ts'],
    ...overrides,
  };
}

function sourceWith(
  commits: readonly RawCommit[],
  pulls: GitHubCommitSource['listPullRequestsForCommit'] = () => Promise.resolve([]),
): GitHubCommitSource {
  return {
    listCommits: () => Promise.resolve(commits),
    listPullRequestsForCommit: pulls,
  };
}

describe('parseRepositoryRef', () => {
  it('parses owner/repo', () => {
    expect(parseRepositoryRef('acme/checkout-service')).toEqual({
      owner: 'acme',
      repo: 'checkout-service',
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRepositoryRef('  acme/api  ')).toEqual({ owner: 'acme', repo: 'api' });
  });

  it('rejects anything that could smuggle a path or query into an API call', () => {
    for (const invalid of ['acme', 'acme/', '/repo', 'acme/repo/extra', 'acme/../secrets', '']) {
      expect(() => parseRepositoryRef(invalid)).toThrow(GitHubRepositoryRefError);
    }
  });

  it('round-trips through formatRepositoryRef', () => {
    expect(formatRepositoryRef(parseRepositoryRef('acme/api'))).toBe('acme/api');
  });
});

describe('classifyTemporalRelation', () => {
  it('places a commit before, inside, or after the window', () => {
    expect(classifyTemporalRelation('2026-08-25T09:00:00.000Z', WINDOW)).toBe('before-anomaly');
    expect(classifyTemporalRelation('2026-08-25T10:00:00.000Z', WINDOW)).toBe(
      'within-anomaly-window',
    );
    expect(classifyTemporalRelation('2026-08-25T12:00:00.000Z', WINDOW)).toBe(
      'within-anomaly-window',
    );
    expect(classifyTemporalRelation('2026-08-25T13:00:00.000Z', WINDOW)).toBe('after-anomaly');
  });

  it('refuses to guess at an unparseable timestamp', () => {
    expect(classifyTemporalRelation('yesterday', WINDOW)).toBeNull();
  });
});

describe('matchPatternHints', () => {
  it('matches hints in the message or a changed path, case-insensitively', () => {
    expect(
      matchPatternHints(
        ['session:', 'cart:'],
        'Fix Session: TTL',
        ['src/cart/items.ts', 'README.md'],
      ),
    ).toEqual(['session:', 'cart:']);
  });

  it('records the original hint, not the haystack spelling', () => {
    expect(matchPatternHints(['session:'], 'SESSION: leak', [])).toEqual(['session:']);
  });

  it('returns nothing when the commit does not mention the pattern', () => {
    expect(matchPatternHints(['session:'], 'tweak dockerfile', ['deploy.yml'])).toEqual([]);
  });
});

describe('findCandidateCommits', () => {
  const request = {
    repository: REPO,
    anomalyWindow: WINDOW,
    lookbackMs: 24 * 60 * 60 * 1_000,
    patternHints: ['session:'],
    maxResults: 50,
  };

  it('widens the search window by lookbackMs', async () => {
    let seenFrom = '';
    const source: GitHubCommitSource = {
      listCommits: (listRequest) => {
        seenFrom = listRequest.window.from;
        return Promise.resolve([]);
      },
      listPullRequestsForCommit: () => Promise.resolve([]),
    };

    await findCandidateCommits(source, request);

    expect(Date.parse(WINDOW.from) - Date.parse(seenFrom)).toBe(request.lookbackMs);
  });

  it('classifies, matches hints, and keeps after-anomaly commits so they can be ruled out', async () => {
    const candidates = await findCandidateCommits(
      sourceWith([
        rawCommit({
          sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          committedAt: '2026-08-25T13:00:00.000Z',
          message: 'too late',
          changedPaths: [],
        }),
        rawCommit({
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          committedAt: '2026-08-25T09:00:00.000Z',
        }),
      ]),
      request,
    );

    expect(candidates.map((candidate) => candidate.temporalRelation)).toEqual([
      'after-anomaly',
      'before-anomaly',
    ]);
    expect(candidates[1]?.matchedPatternHints).toEqual(['session:']);
    expect(candidates[1]?.shortSha).toBe('aaaaaaa');
  });

  it('attaches the merged pull request when several exist', async () => {
    const candidates = await findCandidateCommits(
      sourceWith([rawCommit()], () =>
        Promise.resolve([
          {
            number: 12,
            title: 'Open follow-up',
            url: 'https://github.com/acme/checkout/pull/12',
            mergedAt: null,
            mergeCommitSha: null,
          },
          {
            number: 9,
            title: 'Fix session TTL',
            url: 'https://github.com/acme/checkout/pull/9',
            mergedAt: '2026-08-25T09:05:00.000Z',
            mergeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        ]),
      ),
      request,
    );

    expect(candidates[0]?.pullRequest).toEqual({
      number: 9,
      title: 'Fix session TTL',
      url: 'https://github.com/acme/checkout/pull/9',
      mergedAt: '2026-08-25T09:05:00.000Z',
    });
  });

  it('sorts newest first, then by sha, so the same input always ranks the same', async () => {
    const first = await findCandidateCommits(
      sourceWith([
        rawCommit({ sha: 'cccccccccccccccccccccccccccccccccccccccc', committedAt: WINDOW.from }),
        rawCommit({ sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', committedAt: WINDOW.from }),
      ]),
      request,
    );
    const second = await findCandidateCommits(
      sourceWith([
        rawCommit({ sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', committedAt: WINDOW.from }),
        rawCommit({ sha: 'cccccccccccccccccccccccccccccccccccccccc', committedAt: WINDOW.from }),
      ]),
      request,
    );

    expect(first.map((candidate) => candidate.sha)).toEqual(second.map((candidate) => candidate.sha));
    const firstSha = first[0]?.sha;
    const secondSha = first[1]?.sha;
    expect(firstSha !== undefined && secondSha !== undefined && firstSha < secondSha).toBe(true);
  });

  it('caps the result list at maxResults', async () => {
    const commits = Array.from({ length: 5 }, (_unused, index) =>
      rawCommit({
        sha: `${index}`.repeat(40),
        committedAt: `2026-08-25T09:0${index}:00.000Z`,
      }),
    );

    const candidates = await findCandidateCommits(sourceWith(commits), {
      ...request,
      maxResults: 2,
    });

    expect(candidates).toHaveLength(2);
  });

  it('returns nothing when maxResults is zero', async () => {
    expect(await findCandidateCommits(sourceWith([rawCommit()]), { ...request, maxResults: 0 })).toEqual(
      [],
    );
  });

  it('rejects a negative lookback rather than searching the future', async () => {
    await expect(findCandidateCommits(sourceWith([]), { ...request, lookbackMs: -1 })).rejects.toThrow(
      FindCandidateCommitsError,
    );
  });
});

const SAMPLE_PEM = `-----BEGIN PRIVATE KEY-----
MIIBVA==
-----END PRIVATE KEY-----
`;

describe('loadGitHubAppCredentialsFromEnv', () => {
  it('documents the env vars it expects, and never a personal access token', () => {
    expect(Object.values(GITHUB_APP_ENV_VARS)).toEqual([
      'GITHUB_APP_ID',
      'GITHUB_APP_INSTALLATION_ID',
      'GITHUB_APP_PRIVATE_KEY_PATH',
      'GITHUB_APP_PRIVATE_KEY_BASE64',
    ]);
    expect(Object.values(GITHUB_APP_ENV_VARS)).not.toContain('GITHUB_TOKEN');
    expect(Object.values(GITHUB_APP_ENV_VARS)).not.toContain('GH_TOKEN');
  });

  it('reads the key from base64 when that is the only source', () => {
    const credentials = loadGitHubAppCredentialsFromEnv({
      GITHUB_APP_ID: '42',
      GITHUB_APP_INSTALLATION_ID: '99',
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(SAMPLE_PEM, 'utf8').toString('base64'),
    });

    expect(credentials).toEqual({
      appId: '42',
      installationId: '99',
      privateKeyPem: SAMPLE_PEM,
    });
  });

  it('reads the key from a path through the injected reader', () => {
    const credentials = loadGitHubAppCredentialsFromEnv(
      {
        GITHUB_APP_ID: '42',
        GITHUB_APP_INSTALLATION_ID: '99',
        GITHUB_APP_PRIVATE_KEY_PATH: '/secret/app.pem',
      },
      { readFile: (path) => (path === '/secret/app.pem' ? SAMPLE_PEM : '') },
    );

    expect(credentials.privateKeyPem).toBe(SAMPLE_PEM);
  });

  it('rejects both key sources, and neither', () => {
    const both = {
      GITHUB_APP_ID: '1',
      GITHUB_APP_INSTALLATION_ID: '2',
      GITHUB_APP_PRIVATE_KEY_PATH: '/x.pem',
      GITHUB_APP_PRIVATE_KEY_BASE64: 'YQ==',
    };
    expect(() => loadGitHubAppCredentialsFromEnv(both)).toThrow(GitHubAuthConfigError);
    expect(() => loadGitHubAppCredentialsFromEnv(both)).toThrow(/exactly one/);

    expect(() =>
      loadGitHubAppCredentialsFromEnv({
        GITHUB_APP_ID: '1',
        GITHUB_APP_INSTALLATION_ID: '2',
      }),
    ).toThrow(/private key is required/);
  });

  it('never puts the key in an error about a malformed PEM', () => {
    const secret = 'SUPERSECRETKEYMATERIAL';
    expect(() =>
      loadGitHubAppCredentialsFromEnv({
        GITHUB_APP_ID: '1',
        GITHUB_APP_INSTALLATION_ID: '2',
        GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(secret, 'utf8').toString('base64'),
      }),
    ).toThrow(GitHubAuthConfigError);

    try {
      loadGitHubAppCredentialsFromEnv({
        GITHUB_APP_ID: '1',
        GITHUB_APP_INSTALLATION_ID: '2',
        GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(secret, 'utf8').toString('base64'),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubAuthConfigError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe('createGitHubAppJwt and authenticateGitHubApp', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const now = new Date('2026-08-25T10:00:00.000Z');

  it('signs a verifiable RS256 JWT with clock-skew on iat and a 10-minute exp', () => {
    const jwt = createGitHubAppJwt(pem, '42', now);
    const [, payload] = jwt.split('.');
    expect(payload).toBeDefined();
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
      iat: number;
      exp: number;
      iss: string;
    };

    const nowSeconds = Math.floor(now.getTime() / 1000);
    expect(claims.iss).toBe('42');
    expect(claims.iat).toBe(nowSeconds - 60);
    expect(claims.exp).toBe(nowSeconds + 600);

    const [header, body, signature] = jwt.split('.');
    const verify = createVerify('RSA-SHA256');
    verify.update(`${header}.${body}`);
    expect(verify.verify(publicKey, signature ?? '', 'base64url')).toBe(true);
  });

  it('exchanges the JWT for an installation token scoped to the repository', async () => {
    const requests: GitHubHttpRequest[] = [];
    const http: GitHubHttp = {
      request: (request) => {
        requests.push(request);
        return Promise.resolve({
          status: 201,
          json: {
            token: 'ghs_install',
            expires_at: '2026-08-25T11:00:00.000Z',
          },
          nextPath: null,
          rateLimitRemaining: 5000,
        });
      },
    };

    const token = await authenticateGitHubApp(
      { appId: '42', installationId: '99', privateKeyPem: pem },
      REPO,
      { http, now: () => now },
    );

    expect(token).toEqual({
      token: 'ghs_install',
      expiresAt: '2026-08-25T11:00:00.000Z',
      repository: REPO,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/app/installations/99/access_tokens');
    expect(requests[0]?.body).toEqual({
      permissions: { contents: 'read', pull_requests: 'read' },
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain('ghs_');
  });

  it('surfaces GitHub\'s 422 and says how to install the App, without putting a token in the error', async () => {
    const http: GitHubHttp = {
      request: () =>
        Promise.reject(
          new GitHubApiError(
            'GitHub API request failed with HTTP 422: There is at least one repository that does not exist or is not accessible to the parent installation.',
            422,
            {
              githubMessage:
                'There is at least one repository that does not exist or is not accessible to the parent installation.',
            },
          ),
        ),
    };

    try {
      await authenticateGitHubApp(
        { appId: '42', installationId: '99', privateKeyPem: pem },
        REPO,
        { http, now: () => now },
      );
      throw new Error('expected authenticateGitHubApp to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubAuthError);
      expect((error as Error).message).toContain('acme/checkout');
      expect((error as Error).message).toContain('not accessible to the parent installation');
      expect((error as Error).message).toContain('Contents: Read');
      expect((error as Error).message).not.toContain('ghs_');
    }
  });

  it('does not put the token in the error when GitHub rejects the exchange', async () => {
    const http: GitHubHttp = {
      request: () =>
        Promise.reject(new GitHubApiError('GitHub API request failed with HTTP 401.', 401)),
    };

    await expect(
      authenticateGitHubApp(
        { appId: '42', installationId: '99', privateKeyPem: pem },
        REPO,
        { http, now: () => now },
      ),
    ).rejects.toThrow(GitHubAuthError);

    try {
      await authenticateGitHubApp(
        { appId: '42', installationId: '99', privateKeyPem: pem },
        REPO,
        { http, now: () => now },
      );
    } catch (error) {
      expect((error as Error).message).not.toContain('ghs_');
      expect((error as Error).message).toContain('acme/checkout');
    }
  });
});

function jsonResponse(json: unknown, nextPath: string | null = null): GitHubHttpResponse {
  return { status: 200, json, nextPath, rateLimitRemaining: 4999 };
}

describe('createGitHubHttp', () => {
  it('sends the required GitHub headers and does not put the token in thrown errors', async () => {
    const calls: { url: string; init: { headers: Readonly<Record<string, string>> } }[] = [];
    const http = createGitHubHttp(async (url, init) => {
      calls.push({ url, init });
      return {
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('{"ok":true}'),
      };
    });

    const result = await http.request({
      method: 'GET',
      path: '/rate_limit',
      authorization: 'Bearer secret-token',
    });

    expect(result.json).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://api.github.com/rate_limit');
    expect(calls[0]?.init.headers['User-Agent']).toBe('redis-detective');
    expect(calls[0]?.init.headers['Authorization']).toBe('Bearer secret-token');
  });

  it('includes GitHub\'s error message on a 422 and never echoes a token', async () => {
    const http = createGitHubHttp(async () => ({
      status: 422,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            message: 'Validation Failed',
            errors: [
              'There is at least one repository that does not exist or is not accessible to the parent installation.',
            ],
          }),
        ),
    }));

    try {
      await http.request({
        method: 'POST',
        path: '/app/installations/1/access_tokens',
        authorization: 'Bearer secret-token',
        body: { permissions: { contents: 'read' } },
      });
      throw new Error('expected request to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubApiError);
      const apiError = error as GitHubApiError;
      expect(apiError.status).toBe(422);
      expect(apiError.message).toContain('Validation Failed');
      expect(apiError.message).toContain('not accessible to the parent installation');
      expect(apiError.message).not.toContain('secret-token');
      expect(apiError.githubMessage).not.toContain('secret-token');
    }
  });

  it('surfaces a rate limit as GitHubRateLimitError rather than retrying', async () => {
    const http = createGitHubHttp(async () => ({
      status: 403,
      headers: {
        get: (name: string) => (name === 'x-ratelimit-remaining' ? '0' : null),
      },
      text: () => Promise.resolve('{"message":"rate limited"}'),
    }));

    await expect(
      http.request({ method: 'GET', path: '/repos/a/b/commits', authorization: 'Bearer t' }),
    ).rejects.toThrow(GitHubRateLimitError);
  });
});

describe('createGitHubRestCommitSource', () => {
  it('lists commits, then fetches each for changed paths, then lists PRs', async () => {
    const paths: string[] = [];
    const http: GitHubHttp = {
      request: (request) => {
        paths.push(request.path);
        if (request.path.includes('/pulls')) {
          return Promise.resolve(
            jsonResponse([
              {
                number: 4,
                title: 'Fix TTL',
                html_url: 'https://github.com/acme/checkout/pull/4',
                merged_at: '2026-08-25T09:10:00.000Z',
                merge_commit_sha: 'abc',
              },
            ]),
          );
        }
        if (request.path.includes('/commits/aaa')) {
          return Promise.resolve(
            jsonResponse({
              sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              html_url: 'https://github.com/acme/checkout/commit/aaa',
              commit: {
                message: 'fix session expiry',
                author: { name: 'Ada', email: 'ada@example.com', date: '2026-08-25T09:00:00.000Z' },
                committer: { date: '2026-08-25T09:00:00.000Z' },
              },
              author: { login: 'ada' },
              files: [{ filename: 'src/session/store.ts' }],
            }),
          );
        }
        return Promise.resolve(
          jsonResponse([
            {
              sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              html_url: 'https://github.com/acme/checkout/commit/aaa',
              commit: {
                message: 'fix session expiry',
                author: { name: 'Ada', date: '2026-08-25T09:00:00.000Z' },
                committer: { date: '2026-08-25T09:00:00.000Z' },
              },
            },
          ]),
        );
      },
    };

    const source = createGitHubRestCommitSource({ http, token: 'ghs_x' });
    const commits = await source.listCommits({
      repository: REPO,
      window: WINDOW,
      maxResults: 10,
    });
    const pulls = await source.listPullRequestsForCommit(REPO, commits[0]?.sha ?? '');

    expect(commits[0]?.changedPaths).toEqual(['src/session/store.ts']);
    expect(pulls[0]?.number).toBe(4);
    expect(paths.some((path) => path.includes('/commits?'))).toBe(true);
    expect(paths.some((path) => path.includes('/commits/aaaaaaaa'))).toBe(true);
    expect(paths.every((path) => path.startsWith('/repos/acme/checkout'))).toBe(true);
  });
});
