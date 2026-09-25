import { describe, expect, it } from 'vitest';

import {
  CLI_VERSION,
  EXIT_CODES,
  RedisConnectionError,
  StoredSnapshotError,
  createMemorySnapshotStore,
  main,
} from '@redis-detective/cli';
import type {
  ConnectToRedis,
  CreateCommitSource,
  MainContext,
  OpenSnapshotStore,
  WatchDeps,
} from '@redis-detective/cli';
import { GitHubApiError } from '@redis-detective/github-integration';
import { SAMPLER_DEFAULTS, SAMPLER_HARD_LIMITS } from '@redis-detective/sampler';
import { leakingSnapshots } from './helpers/leaking-snapshots.js';
import { fakeGitHubCommitSource, rawCommit } from './helpers/fake-github-commit-source.js';
import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';

interface CapturedRun {
  readonly exitCode: number;
  readonly out: string;
  readonly err: string;
}

/**
 * A leaky instance: a large pattern that never expires beside a healthy one that does.
 * Enough for the command to produce a report with real findings in it.
 */
function leakyInstance(): FakeRedisCommandClient {
  return new FakeRedisCommandClient({
    databases: {
      0: {
        ...fakeKeys('cart:items:', 200, { bytes: 8_192 }),
        ...fakeKeys('session:', 400, { bytes: 128, ttlMs: 3_600_000 }),
      },
    },
  });
}

/**
 * `connect` is always injected, so no test here opens a socket. A default that fell through to the
 * real driver would make this suite quietly network-dependent.
 */
async function run(
  argv: readonly string[],
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly connect?: ConnectToRedis;
    readonly openSnapshotStore?: OpenSnapshotStore;
    readonly createCommitSource?: CreateCommitSource;
    readonly stopSignal?: AbortSignal;
    readonly watchDeps?: WatchDeps;
  } = {},
): Promise<CapturedRun> {
  let out = '';
  let err = '';

  const context: MainContext = {
    argv,
    env: options.env ?? {},
    streams: {
      writeOut: (text) => {
        out += text;
      },
      writeError: (text) => {
        err += text;
      },
    },
    now: () => new Date('2026-08-25T11:00:00.000Z'),
    connect:
      options.connect ??
      (() => Promise.resolve({ client: leakyInstance(), close: () => Promise.resolve() })),
    ...(options.openSnapshotStore === undefined
      ? {}
      : { openSnapshotStore: options.openSnapshotStore }),
    ...(options.createCommitSource === undefined
      ? {}
      : { createCommitSource: options.createCommitSource }),
    ...(options.stopSignal === undefined ? {} : { stopSignal: options.stopSignal }),
    ...(options.watchDeps === undefined ? {} : { watchDeps: options.watchDeps }),
  };

  const exitCode = await main(context);
  return { exitCode, out, err };
}

describe('main', () => {
  describe('usage', () => {
    it('prints help and exits cleanly', async () => {
      const result = await run(['--help']);

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('Redis Memory Health Check');
      expect(result.err).toBe('');
    });

    it('advertises the read-only safety guarantee in help', async () => {
      expect((await run(['--help'])).out).toContain('never runs KEYS');
    });

    it('documents --redact-keys', async () => {
      expect((await run(['--help'])).out).toContain('--redact-keys');
    });

    it('documents --snapshots', async () => {
      expect((await run(['--help'])).out).toContain('--snapshots');
    });

    it('states the ceiling --timeout is clamped to, so it is not raised in vain', async () => {
      const help = (await run(['--help'])).out;

      expect(help).toContain('--timeout');
      expect(help).toContain(`ceiling of ${String(SAMPLER_HARD_LIMITS.maxDurationMs)}`);
    });

    it('documents the watch command, its interval and what it will not do', async () => {
      const help = (await run(['--help'])).out;

      expect(help).toContain('watch');
      expect(help).toContain('--interval');
      expect(help).toContain('Ctrl-C stops after the sample in flight');
      expect(help).toContain('never looked up while watching');
    });

    it('documents --memory-samples with its default and its ceiling', async () => {
      const help = (await run(['--help'])).out;

      expect(help).toContain('--memory-samples');
      expect(help).toContain(
        `of ${String(SAMPLER_HARD_LIMITS.maxMemoryUsageSamples)} (default ${String(SAMPLER_DEFAULTS.memoryUsageSamples)})`,
      );
    });

    it('documents --repo as GitHub App auth, not a personal token', async () => {
      const help = (await run(['--help'])).out;
      expect(help).toContain('--repo');
      expect(help).toContain('GitHub App');
      expect(help).toContain('never');
      expect(help).toContain('personal access token');
      expect(help).toContain('.env');
      expect(help).toContain('LLM_API_KEY');
    });

    it('prints the version', async () => {
      const result = await run(['--version']);

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toBe(`redis-detective ${CLI_VERSION}\n`);
    });

    it('explains how to supply a URL when none is available', async () => {
      const result = await run([]);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--url');
    });

    it('reports a usage error for an unknown flag', async () => {
      const result = await run(['--definitely-not-a-flag']);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('Unknown option');
    });

    it('reads the URL from the environment', async () => {
      const result = await run([], { env: { REDIS_URL: 'redis://localhost:6379' } });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
    });
  });

  describe('reporting', () => {
    it('writes a text report and exits zero', async () => {
      const result = await run(['--url', 'redis://localhost:6379']);

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('Redis Memory Health Check');
      expect(result.out).toContain('cart:items:*');
      expect(result.err).toBe('');
    });

    it('writes JSON on --json and nothing else, so the output stays pipeable', async () => {
      const result = await run(['--url', 'redis://localhost:6379', '--json']);

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(() => JSON.parse(result.out) as unknown).not.toThrow();
      expect(result.err).toBe('');
    });

    it('applies --memory-samples to every MEMORY USAGE call the sampler makes', async () => {
      const client = leakyInstance();
      const result = await run(['--url', 'redis://localhost:6379', '--memory-samples', '2'], {
        connect: () => Promise.resolve({ client, close: () => Promise.resolve() }),
      });
      const memoryCalls = client.issuedCommands.filter((command) =>
        command.startsWith('MEMORY USAGE'),
      );

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(memoryCalls.length).toBeGreaterThan(0);
      expect(memoryCalls.every((command) => command.endsWith('SAMPLES 2'))).toBe(true);
    });

    it('redacts example keys on --redact-keys', async () => {
      const result = await run(['--url', 'redis://localhost:6379', '--redact-keys']);

      expect(result.out).toContain('cart:items:*');
      expect(result.out).not.toMatch(/cart:items:\d/);
    });

    it('reports the target without its credentials', async () => {
      const result = await run(['--url', 'redis://user:sup3rs3cret@localhost:6379']);

      expect(`${result.out}${result.err}`).not.toContain('sup3rs3cret');
      expect(result.out).toContain('redis://user:***@localhost:6379');
    });
  });

  describe('diagnosis', () => {
    it('does not open Redis when --snapshots is given without a URL', async () => {
      let connected = false;
      const store = createMemorySnapshotStore(leakingSnapshots());
      const result = await run(['--snapshots', './snaps'], {
        connect: () => {
          connected = true;
          return Promise.reject(new Error('should not connect'));
        },
        openSnapshotStore: () => store,
      });

      expect(connected).toBe(false);
      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('Redis Memory Diagnosis');
      expect(result.out).toContain('Why');
      expect(result.out).toContain('cart:items:*');
      expect(result.out).toContain('keys stopped expiring');
    });

    it('saves a live sample and reports that one snapshot cannot establish growth', async () => {
      const store = createMemorySnapshotStore();
      const result = await run(['--url', 'redis://localhost:6379', '--snapshots', './snaps'], {
        openSnapshotStore: () => store,
      });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('Not enough snapshots');
      expect(await store.list()).toHaveLength(1);
    });

    it('writes diagnosis JSON on --json', async () => {
      const result = await run(['--snapshots', './snaps', '--json'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      const parsed = JSON.parse(result.out) as { reportType: string };
      expect(parsed.reportType).toBe('diagnosis');
      expect(result.err).toBe('');
    });

    it('reports an unreadable snapshot file with a dedicated exit code', async () => {
      const result = await run(['--snapshots', './snaps'], {
        openSnapshotStore: () => ({
          describe: './snaps',
          list: () =>
            Promise.reject(new StoredSnapshotError('snaps/broken.snapshot.json is not valid JSON')),
          save: () => Promise.reject(new Error('should not save')),
        }),
      });

      expect(result.exitCode).toBe(EXIT_CODES.snapshotError);
      expect(result.err).toContain('broken.snapshot.json');
      expect(result.out).toBe('');
    });

    it('records that no repository was connected rather than inventing a commit', async () => {
      const result = await run(['--snapshots', './snaps'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('No repository connected');
      expect(result.out).not.toContain('Candidate commits');
    });

    it('rejects --repo without --snapshots', async () => {
      const result = await run(['--url', 'redis://localhost:6379', '--repo', 'acme/checkout']);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--snapshots');
    });

    it('rejects --lookback-hours without --repo', async () => {
      const result = await run(['--snapshots', './snaps', '--lookback-hours', '24'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--repo');
    });

    it('rejects a malformed --repo rather than interpolating it into an API path', async () => {
      const result = await run(['--snapshots', './snaps', '--repo', 'acme/../secrets'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('owner/repo');
    });

    it('lists candidate commits when a fake GitHub source is injected', async () => {
      const result = await run(['--snapshots', './snaps', '--repo', 'acme/checkout'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        createCommitSource: () => Promise.resolve(fakeGitHubCommitSource([rawCommit()])),
      });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('Candidate commits');
      expect(result.out).toContain('acme/checkout');
      expect(result.out).toContain('aaaaaaa');
      expect(result.out).toContain('hint, not proof');
      expect(result.out).not.toContain('No repository connected');
    });

    it('prints the Redis diagnosis when GitHub App credentials are missing after --repo', async () => {
      const result = await run(['--snapshots', './snaps', '--repo', 'acme/checkout'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.githubError);
      expect(result.err).toContain('GITHUB_APP_ID');
      expect(result.err).toContain('.env');
      expect(result.out).toContain('cart:items:*');
      expect(result.out).toContain('GitHub unavailable');
    });

    it('prints the Redis diagnosis when GitHub fails after --repo, then exits non-zero', async () => {
      const result = await run(['--snapshots', './snaps', '--repo', 'acme/checkout'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        createCommitSource: () =>
          Promise.reject(new GitHubApiError('GitHub API request failed with HTTP 500', 500)),
      });

      expect(result.exitCode).toBe(EXIT_CODES.githubError);
      expect(result.err).toContain('HTTP 500');
      expect(result.out).toContain('cart:items:*');
      expect(result.out).toContain('GitHub unavailable');
      expect(result.out).toContain('HTTP 500');
    });

    it('does not treat GITHUB_REPOSITORY alone as a request to call GitHub', async () => {
      let created = false;
      const result = await run(['--snapshots', './snaps'], {
        env: { GITHUB_REPOSITORY: 'acme/checkout' },
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        createCommitSource: () => {
          created = true;
          return Promise.resolve(fakeGitHubCommitSource());
        },
      });

      expect(created).toBe(false);
      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('No repository connected');
    });
  });

  describe('watch', () => {
    /** Stops the session after the first interval, so no test waits on a real clock. */
    function stopAfterFirstInterval(stop: AbortController, waits: number[]): WatchDeps {
      return {
        wait: (ms) => {
          waits.push(ms);
          stop.abort();
          return Promise.resolve();
        },
      };
    }

    it('samples into the snapshot directory on the requested interval and exits zero', async () => {
      const stop = new AbortController();
      const store = createMemorySnapshotStore([], './snaps');
      const waits: number[] = [];

      const result = await run(
        ['watch', '--url', 'redis://localhost:6379', '--snapshots', './snaps', '--interval', '15m'],
        {
          openSnapshotStore: () => store,
          stopSignal: stop.signal,
          watchDeps: stopAfterFirstInterval(stop, waits),
        },
      );

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(waits).toEqual([900_000]);
      expect(await store.list()).toHaveLength(1);
      expect(result.out).toContain('Watching redis://localhost:6379 every 15m');
      expect(result.out).toContain('keys sampled');
      expect(result.out).toContain('Full diagnosis: redis-detective --snapshots ./snaps');
      expect(result.err).toBe('');
    });

    it('closes the Redis connection once the session stops', async () => {
      const stop = new AbortController();
      let closed = false;

      await run(['watch', '--url', 'redis://localhost:6379', '--snapshots', './snaps'], {
        connect: () =>
          Promise.resolve({
            client: leakyInstance(),
            close: () => {
              closed = true;
              return Promise.resolve();
            },
          }),
        openSnapshotStore: () => createMemorySnapshotStore(),
        stopSignal: stop.signal,
        watchDeps: stopAfterFirstInterval(stop, []),
      });

      expect(closed).toBe(true);
    });

    // Watching for a day would otherwise spend a rate limit re-reading the same commit window.
    it('never reaches GitHub while watching, even with --repo', async () => {
      const stop = new AbortController();
      let commitSources = 0;

      const result = await run(
        ['watch', '--url', 'redis://localhost:6379', '--snapshots', './snaps', '--repo', 'acme/checkout'],
        {
          openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
          createCommitSource: () => {
            commitSources += 1;
            return Promise.resolve(fakeGitHubCommitSource([rawCommit()]));
          },
          stopSignal: stop.signal,
          watchDeps: stopAfterFirstInterval(stop, []),
        },
      );

      expect(commitSources).toBe(0);
      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('makes no GitHub requests');
      // Nothing from a commit list: no candidate sha, and none of the wording that frames one.
      expect(result.out).not.toContain('aaaaaaa');
      expect(result.out).not.toContain('hint, not proof');
    });

    it('requires a directory to accumulate samples in', async () => {
      const result = await run(['watch', '--url', 'redis://localhost:6379']);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--snapshots');
    });

    it('requires a live instance to sample', async () => {
      const result = await run(['watch', '--snapshots', './snaps']);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--url');
    });

    it('refuses --json rather than quietly printing prose to a pipe', async () => {
      const result = await run([
        'watch',
        '--url',
        'redis://localhost:6379',
        '--snapshots',
        './snaps',
        '--json',
      ]);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--json');
    });

    it('rejects --interval outside the watch command instead of ignoring it', async () => {
      const result = await run(['--url', 'redis://localhost:6379', '--interval', '15m']);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('watch');
    });
  });

  describe('failure', () => {
    it('reports a connection failure with a dedicated exit code', async () => {
      const result = await run(['--url', 'redis://localhost:6379'], {
        connect: () => Promise.reject(new RedisConnectionError('connection refused')),
      });

      expect(result.exitCode).toBe(EXIT_CODES.connectionError);
      expect(result.err).toContain('connection refused');
      expect(result.out).toBe('');
    });

    it('does not leak the password when the connection fails', async () => {
      const result = await run(['--url', 'redis://user:sup3rs3cret@localhost:6379'], {
        connect: () => Promise.reject(new RedisConnectionError('connection refused')),
      });

      expect(`${result.out}${result.err}`).not.toContain('sup3rs3cret');
    });

    it('closes the connection even when the health check throws', async () => {
      let closed = false;
      const result = await run(['--url', 'redis://localhost:6379'], {
        connect: () =>
          Promise.resolve({
            client: {
              info: () => Promise.reject(new Error('INFO is disabled on this instance')),
              select: () => Promise.resolve(),
              dbSize: () => Promise.resolve(0),
              scan: () => Promise.resolve({ cursor: '0', keys: [] }),
              type: () => Promise.resolve('none'),
              pttl: () => Promise.resolve(null),
              memoryUsage: () => Promise.resolve(null),
            },
            close: () => {
              closed = true;
              return Promise.resolve();
            },
          }),
      }).catch((error: unknown) => error);

      expect(closed).toBe(true);
      expect(result).toBeInstanceOf(Error);
    });
  });
});
