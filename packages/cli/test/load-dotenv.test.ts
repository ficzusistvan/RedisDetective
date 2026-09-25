import { describe, expect, it } from 'vitest';

import { loadDotenv } from '@redis-detective/cli';

describe('loadDotenv', () => {
  it('loads KEY=value pairs into an empty env', () => {
    const env: Record<string, string | undefined> = {};

    const loaded = loadDotenv({
      cwd: '/repo',
      env,
      exists: (path) => path === '/repo/.env',
      readFile: () => 'GITHUB_APP_ID=42\nGITHUB_APP_INSTALLATION_ID=99\n',
    });

    expect(loaded).toBe('/repo/.env');
    expect(env['GITHUB_APP_ID']).toBe('42');
    expect(env['GITHUB_APP_INSTALLATION_ID']).toBe('99');
  });

  it('does not override a variable already set in the environment', () => {
    const env: Record<string, string | undefined> = { GITHUB_APP_ID: 'from-shell' };

    loadDotenv({
      cwd: '/repo',
      env,
      exists: (path) => path === '/repo/.env',
      readFile: () => 'GITHUB_APP_ID=from-file\n',
    });

    expect(env['GITHUB_APP_ID']).toBe('from-shell');
  });

  it('skips comments, blanks, and export prefixes, and strips quotes', () => {
    const env: Record<string, string | undefined> = {};

    loadDotenv({
      cwd: '/repo',
      env,
      exists: (path) => path === '/repo/.env',
      readFile: () =>
        [
          '# not loaded',
          '',
          'export REDIS_URL="redis://localhost:6379"',
          "GITHUB_APP_PRIVATE_KEY_PATH='/tmp/app.pem'",
          'GITHUB_APP_ID=42 # inline comment',
        ].join('\n'),
    });

    expect(env['REDIS_URL']).toBe('redis://localhost:6379');
    expect(env['GITHUB_APP_PRIVATE_KEY_PATH']).toBe('/tmp/app.pem');
    expect(env['GITHUB_APP_ID']).toBe('42');
  });

  it('walks up from cwd so a command run in a subdirectory still finds the repo .env', () => {
    const env: Record<string, string | undefined> = {};

    const loaded = loadDotenv({
      cwd: '/repo/packages/cli',
      env,
      exists: (path) => path === '/repo/.env',
      readFile: (path) => {
        expect(path).toBe('/repo/.env');
        return 'GITHUB_APP_ID=42\n';
      },
    });

    expect(loaded).toBe('/repo/.env');
    expect(env['GITHUB_APP_ID']).toBe('42');
  });

  it('is a no-op when no .env file exists', () => {
    const env: Record<string, string | undefined> = {};

    expect(
      loadDotenv({
        cwd: '/repo',
        env,
        exists: () => false,
        readFile: () => {
          throw new Error('should not read');
        },
      }),
    ).toBeNull();
    expect(env).toEqual({});
  });
});
