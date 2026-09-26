import { describe, expect, it } from 'vitest';

import { createGitHubCommitSource, resolvePersonalGitHubToken } from '@redis-detective/cli';
import { GitHubAuthConfigError, isGitHubAppEnvComplete } from '@redis-detective/github-integration';

describe('resolvePersonalGitHubToken', () => {
  it('prefers gh auth token over env tokens', async () => {
    const token = await resolvePersonalGitHubToken(
      { GITHUB_TOKEN: 'from-github-token', GH_TOKEN: 'from-gh-token' },
      { readGhAuthToken: () => Promise.resolve('from-gh-cli') },
    );

    expect(token).toBe('from-gh-cli');
  });

  it('falls through gh -> GITHUB_TOKEN -> GH_TOKEN', async () => {
    expect(
      await resolvePersonalGitHubToken(
        { GH_TOKEN: 'from-gh-token' },
        { readGhAuthToken: () => Promise.resolve(null) },
      ),
    ).toBe('from-gh-token');

    expect(
      await resolvePersonalGitHubToken(
        { GITHUB_TOKEN: 'from-github-token', GH_TOKEN: 'from-gh-token' },
        { readGhAuthToken: () => Promise.resolve(null) },
      ),
    ).toBe('from-github-token');
  });
});

describe('createGitHubCommitSource', () => {
  const repository = { owner: 'acme', repo: 'checkout' };
  const now = () => new Date('2026-08-25T12:00:00.000Z');

  it('uses GITHUB_TOKEN instead of gh when gh discovery is skipped', async () => {
    const seenAuth: string[] = [];
    const source = await createGitHubCommitSource({
      env: { GITHUB_TOKEN: 'from-env' },
      repository,
      now,
      skipGh: true,
      readGhAuthToken: () => Promise.resolve('from-gh-cli'),
      fetchImpl: (_url, init) => {
        seenAuth.push(init.headers['Authorization'] ?? '');
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve('[]'),
        });
      },
    });

    await source.listCommits({
      repository,
      window: { from: '2026-08-25T10:00:00.000Z', to: '2026-08-25T12:00:00.000Z' },
      maxResults: 1,
    });

    expect(seenAuth).toEqual(['Bearer from-env']);
  });

  it('does not accept a gh login as a credential when gh discovery is skipped', async () => {
    await expect(
      createGitHubCommitSource({
        env: {},
        repository,
        now,
        skipGh: true,
        readGhAuthToken: () => Promise.resolve('from-gh-cli'),
        fetchImpl: () => {
          throw new Error('fetch should not run');
        },
      }),
    ).rejects.toThrow(/GITHUB_TOKEN[\s\S]*gh auth token is not consulted/);
  });

  it('uses a personal token when App env is incomplete', async () => {
    const seenAuth: string[] = [];
    const source = await createGitHubCommitSource({
      env: { GITHUB_TOKEN: 'personal-token' },
      repository,
      now,
      readGhAuthToken: () => Promise.resolve(null),
      fetchImpl: (_url, init) => {
        seenAuth.push(init.headers['Authorization'] ?? '');
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve('[]'),
        });
      },
    });

    await source.listCommits({
      repository,
      window: { from: '2026-08-25T10:00:00.000Z', to: '2026-08-25T12:00:00.000Z' },
      maxResults: 1,
    });

    expect(seenAuth.some((value) => value.includes('personal-token'))).toBe(true);
  });

  it('rejects when App env is incomplete and no personal credential exists', async () => {
    await expect(
      createGitHubCommitSource({
        env: {},
        repository,
        now,
        readGhAuthToken: () => Promise.resolve(null),
        fetchImpl: () => {
          throw new Error('fetch should not run');
        },
      }),
    ).rejects.toBeInstanceOf(GitHubAuthConfigError);
  });

  it('does not use a personal token when App env is complete', () => {
    expect(
      isGitHubAppEnvComplete({
        GITHUB_APP_ID: '1',
        GITHUB_APP_INSTALLATION_ID: '2',
        GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
          '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
        ).toString('base64'),
        GITHUB_TOKEN: 'should-be-ignored',
      }),
    ).toBe(true);
  });
});
