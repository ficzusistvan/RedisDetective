import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CLI_VERSION,
  EXIT_CODES,
  RedisConnectionError,
  StoredSnapshotError,
  createMemoryPushStateStore,
  createMemorySnapshotStore,
  estimateMultipartBodyBytes,
  main,
  pushCandidatesFromStore,
} from '@redis-detective/cli';
import type {
  ConnectToRedis,
  CreateCommitSource,
  FetchLike,
  MainContext,
  OpenSnapshotStore,
  PushStateStore,
  WatchDeps,
} from '@redis-detective/cli';
import type { AlertFetch, AlertStateStore, AlertWait } from '@redis-detective/alerts';
import { createMemoryAlertStateStore } from '@redis-detective/alerts';
import { GitHubApiError } from '@redis-detective/github-integration';
import type { GitHubFetch } from '@redis-detective/github-integration';
import { SAMPLER_DEFAULTS, SAMPLER_HARD_LIMITS } from '@redis-detective/sampler';
import { leakingSnapshots } from './helpers/leaking-snapshots.js';
import { patternFixture, snapshotFixture } from './helpers/snapshot-builder.js';
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
    readonly readGhAuthToken?: () => Promise<string | null>;
    readonly githubFetch?: GitHubFetch;
    readonly stopSignal?: AbortSignal;
    readonly watchDeps?: WatchDeps;
    readonly alertFetch?: AlertFetch;
    readonly alertWait?: AlertWait;
    readonly openAlertStateStore?: (path: string) => AlertStateStore;
    readonly fetch?: FetchLike;
    readonly openPushStateStore?: (path: string) => PushStateStore;
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
    // Never shell out to `gh` in this suite.
    readGhAuthToken: options.readGhAuthToken ?? (() => Promise.resolve(null)),
    ...(options.githubFetch === undefined ? {} : { githubFetch: options.githubFetch }),
    ...(options.openSnapshotStore === undefined
      ? {}
      : { openSnapshotStore: options.openSnapshotStore }),
    ...(options.createCommitSource === undefined
      ? {}
      : { createCommitSource: options.createCommitSource }),
    ...(options.stopSignal === undefined ? {} : { stopSignal: options.stopSignal }),
    ...(options.watchDeps === undefined ? {} : { watchDeps: options.watchDeps }),
    alertFetch:
      options.alertFetch ?? (() => Promise.reject(new Error('unit tests must not send alerts'))),
    alertWait: options.alertWait ?? (() => Promise.resolve()),
    openAlertStateStore: options.openAlertStateStore ?? (() => createMemoryAlertStateStore()),
    fetch: options.fetch ?? (() => Promise.reject(new Error('unit tests must not push snapshots'))),
    openPushStateStore: options.openPushStateStore ?? (() => createMemoryPushStateStore()),
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

    it('documents --repo with App preferred and solo gh/token fallback', async () => {
      const help = (await run(['--help'])).out;
      expect(help).toContain('--repo');
      expect(help).toContain('--skip-gh');
      expect(help).toContain('GitHub App');
      expect(help).toContain('Solo fallback');
      expect(help).toContain('gh auth');
      expect(help).toContain('GITHUB_TOKEN');
      expect(help).toContain('memory growth');
      expect(help).toContain('.env');
      expect(help).toContain('LLM_API_KEY');
      expect(help).toContain('--format');
      expect(help).toContain('markdown');
      expect(help).toContain('--write-json');
      expect(help).toContain('--fail-on-ttl-drop');
      expect(help).toContain('--fail-on-growth-percent');
      expect(help).toContain('--warn-only');
      expect(help).toContain('Exit 7');
      expect(help).toContain('--alert-slack-webhook');
      expect(help).toContain('test-alert');
      expect(help).toContain('--alert-dry-run');
      expect(help).toContain('X-Redis-Detective-Signature');
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

    it('reports a ~5% rise on a ~909 MiB instance in human units', async () => {
      const result = await run(['--snapshots', './snaps', '--json'], {
        openSnapshotStore: () => createMemorySnapshotStore(largeInstanceSnapshots()),
      });
      const report = JSON.parse(result.out) as {
        explanation: {
          headline: string;
          summary: string;
          likelyCause: { pattern: string } | null;
          evidenceStrength: string;
        };
        graph: {
          anomalies: readonly { kind: string }[];
          attributions: readonly { pattern: string }[];
        };
      };
      const prose = `${report.explanation.headline}\n${report.explanation.summary}`;

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(report.graph.anomalies.map((anomaly) => anomaly.kind)).toContain('memory-growth');
      expect(report.graph.attributions.map((attribution) => attribution.pattern)).toContain(
        'session:*',
      );
      expect(report.graph.attributions.map((attribution) => attribution.pattern)).not.toContain(
        'cache:*',
      );
      expect(report.explanation.likelyCause?.pattern).toBe('session:*');
      expect(prose).toContain('session:*');
      expect(prose).toMatch(/MiB|GiB/);
      expect(prose).toContain('2026-11-14 03:30 UTC');
      expect(prose).not.toContain('No memory growth was found in this window.');
      expect(prose).not.toContain('8388608');
      expect(prose).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('says a smaller rise is below the anomaly thresholds instead of claiming no growth', async () => {
      const result = await run(['--snapshots', './snaps', '--json'], {
        openSnapshotStore: () => createMemorySnapshotStore(belowThresholdSnapshots()),
      });
      const report = JSON.parse(result.out) as {
        explanation: {
          headline: string;
          summary: string;
          likelyCause: { pattern: string } | null;
          evidenceStrength: string;
        };
      };
      const prose = `${report.explanation.headline}\n${report.explanation.summary}`;

      expect(report.explanation.headline).toBe(
        'Memory grew 10 MiB (+1%), below anomaly thresholds (8 MiB and 2%).',
      );
      expect(report.explanation.summary).toContain(
        'session:* contributed the most estimated growth, 8 MiB, as more keys',
      );
      expect(report.explanation.summary).not.toContain('cache:*');
      expect(report.explanation.likelyCause).toBeNull();
      expect(report.explanation.evidenceStrength).toBe('unclear');
      expect(prose).not.toContain('8388608');
      expect(prose).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('threads --min-growth-bytes and --min-growth-ratio into the diagnosis', async () => {
      const quiet = await run(['--snapshots', './snaps', '--json'], {
        openSnapshotStore: () => createMemorySnapshotStore(belowThresholdSnapshots()),
      });
      const lowered = await run(
        [
          '--snapshots',
          './snaps',
          '--json',
          '--min-growth-bytes',
          '1048576',
          '--min-growth-ratio',
          '0.005',
        ],
        {
          openSnapshotStore: () => createMemorySnapshotStore(belowThresholdSnapshots()),
        },
      );
      const quietReport = JSON.parse(quiet.out) as {
        graph: { anomalies: readonly { kind: string }[] };
      };
      const loweredReport = JSON.parse(lowered.out) as {
        explanation: { headline: string };
        graph: { anomalies: readonly { kind: string }[] };
      };

      expect(quietReport.graph.anomalies).toEqual([]);
      expect(loweredReport.graph.anomalies.map((anomaly) => anomaly.kind)).toContain(
        'memory-growth',
      );
      expect(loweredReport.explanation.headline).not.toContain('below anomaly thresholds');
    });

    it('rejects an impossible growth ratio as a usage error', async () => {
      const result = await run(['--snapshots', './snaps', '--min-growth-ratio', '1.5']);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('minGrowthRatio');
    });

    it('writes diagnosis JSON on --json', async () => {
      const result = await run(['--snapshots', './snaps', '--json'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      const parsed = JSON.parse(result.out) as { reportType: string; gate?: unknown };
      expect(parsed.reportType).toBe('diagnosis');
      expect(parsed.gate).toBeUndefined();
      expect(result.err).toBe('');
    });

    it('writes Markdown on --format markdown and never prints example keys', async () => {
      const result = await run(['--snapshots', './snaps', '--format', 'markdown'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('# Redis Memory Diagnosis');
      expect(result.out).toContain('cart:items:*');
      expect(result.out).not.toMatch(/cart:items:[0-9a-f]{4}/);
    });

    it('exits 7 when a TTL-drop gate is crossed', async () => {
      const result = await run(
        ['--snapshots', './snaps', '--format', 'markdown', '--fail-on-ttl-drop', '20'],
        {
          openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        },
      );

      expect(result.exitCode).toBe(EXIT_CODES.thresholdExceeded);
      expect(result.out).toContain('## Gate');
      expect(result.out).toContain('**Outcome:** fail');
      expect(result.out).toContain('cart:items:*');
    });

    it('exits 0 under --warn-only even when a gate is crossed', async () => {
      const result = await run(
        ['--snapshots', './snaps', '--fail-on-ttl-drop', '20', '--warn-only'],
        {
          openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        },
      );

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('Gate');
      expect(result.out).toContain('warn-only');
    });

    it('rejects gate flags without --snapshots', async () => {
      const result = await run(['--url', 'redis://localhost:6379', '--fail-on-ttl-drop', '20']);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--snapshots');
    });

    it('writes JSON to --write-json while keeping Markdown on stdout', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'redis-detective-gate-'));
      const jsonPath = join(dir, 'report.json');
      try {
        const result = await run(
          [
            '--snapshots',
            './snaps',
            '--format',
            'markdown',
            '--write-json',
            jsonPath,
            '--fail-on-ttl-drop',
            '20',
          ],
          {
            openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
          },
        );

        expect(result.exitCode).toBe(EXIT_CODES.thresholdExceeded);
        expect(result.out.startsWith('# Redis Memory Diagnosis')).toBe(true);
        const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as {
          reportType: string;
          gate: { outcome: string; findings: readonly { pattern: string }[] };
        };
        expect(parsed.reportType).toBe('diagnosis');
        expect(parsed.gate.outcome).toBe('fail');
        expect(parsed.gate.findings[0]?.pattern).toBe('cart:items:*');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('does not print Redis credentials in Markdown diagnosis output', async () => {
      const result = await run(
        [
          '--url',
          'redis://user:sup3rs3cret@localhost:6379',
          '--snapshots',
          './snaps',
          '--format',
          'markdown',
        ],
        {
          openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        },
      );

      expect(`${result.out}${result.err}`).not.toContain('sup3rs3cret');
      expect(result.out).toContain('redis://user:***@localhost:6379');
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

    it('uses GITHUB_TOKEN and does not use gh when --skip-gh is set', async () => {
      const seenAuth: string[] = [];
      const githubFetch: GitHubFetch = (_url, init) => {
        seenAuth.push(init.headers['Authorization'] ?? '');
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve('[]'),
        });
      };

      const result = await run(['--snapshots', './snaps', '--repo', 'acme/checkout', '--skip-gh'], {
        env: { GITHUB_TOKEN: 'from-env' },
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        readGhAuthToken: () => Promise.resolve('from-gh-cli'),
        githubFetch,
      });

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(seenAuth).toEqual(['Bearer from-env']);
      expect(result.out).toContain('cart:items:*');
    });

    it('ignores a gh login when --skip-gh is set and no token is in the environment', async () => {
      let fetched = false;
      const result = await run(['--snapshots', './snaps', '--repo', 'acme/checkout', '--skip-gh'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
        readGhAuthToken: () => Promise.resolve('from-gh-cli'),
        githubFetch: () => {
          fetched = true;
          return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () => Promise.resolve('[]'),
          });
        },
      });

      expect(fetched).toBe(false);
      expect(result.exitCode).toBe(EXIT_CODES.githubError);
      expect(result.err).toContain('gh auth token is not consulted');
      expect(result.out).toContain('cart:items:*');
    });

    it('prints the Redis diagnosis when GitHub credentials are missing after --repo', async () => {
      const result = await run(['--snapshots', './snaps', '--repo', 'acme/checkout'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots()),
      });

      expect(result.exitCode).toBe(EXIT_CODES.githubError);
      expect(result.err).toContain('No GitHub credentials');
      expect(result.err).toContain('gh auth');
      expect(result.out).toContain('cart:items:*');
      expect(result.out).toContain('GitHub unavailable');
    });

    it('does not authenticate to GitHub when --repo is set but only one snapshot exists', async () => {
      let created = false;
      const result = await run(['--snapshots', './snaps', '--repo', 'acme/checkout'], {
        openSnapshotStore: () => createMemorySnapshotStore(leakingSnapshots().slice(0, 1)),
        createCommitSource: () => {
          created = true;
          return Promise.resolve(fakeGitHubCommitSource());
        },
      });

      expect(created).toBe(false);
      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('Candidate commits');
      expect(result.out).not.toContain('GitHub unavailable');
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
        [
          'watch',
          '--url',
          'redis://localhost:6379',
          '--snapshots',
          './snaps',
          '--repo',
          'acme/checkout',
        ],
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

    it('accepts --fail-on-* as alert thresholds and dry-runs a payload without sending', async () => {
      const stop = new AbortController();
      const store = createMemorySnapshotStore(leakingSnapshots(), './snaps');
      const fetches: string[] = [];

      const result = await run(
        [
          'watch',
          '--url',
          'redis://localhost:6379',
          '--snapshots',
          './snaps',
          '--fail-on-ttl-drop',
          '20',
          '--alert-slack-webhook',
          'https://hooks.slack.com/services/T000/B000/secret',
          '--alert-dry-run',
        ],
        {
          openSnapshotStore: () => store,
          stopSignal: stop.signal,
          watchDeps: stopAfterFirstInterval(stop, []),
          alertFetch: (url) => {
            fetches.push(url);
            return Promise.resolve({ status: 200, body: 'ok' });
          },
        },
      );

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(fetches).toEqual([]);
      expect(result.out).toContain('Alerts: slack');
      expect(result.out).toContain('alert firing');
      expect(result.out).toContain('--- alert dry-run slack ---');
      expect(result.out).toContain('cart:items:*');
      expect(result.out).not.toContain('secret');
      expect(result.out).not.toContain('T000');
    });

    it('keeps watching and exits zero when a push is rejected', async () => {
      const stop = new AbortController();
      const store = createMemorySnapshotStore([], './snaps');
      const pushState = createMemoryPushStateStore();
      const names: string[][] = [];
      let pushes = 0;

      const result = await run(
        [
          'watch',
          '--url',
          'redis://localhost:6379',
          '--snapshots',
          './snaps',
          '--interval',
          '15m',
          '--push',
          '--web-url',
          'https://app.example.com',
          '--instance',
          'inst-1',
          '--token',
          'rdp_secret',
        ],
        {
          openSnapshotStore: () => store,
          openPushStateStore: () => pushState,
          stopSignal: stop.signal,
          watchDeps: {
            wait: () => {
              pushes += 1;
              if (pushes >= 2) {
                stop.abort();
              }
              return Promise.resolve();
            },
          },
          fetch: async (_url, init) => {
            const body = init?.body;
            if (!(body instanceof FormData)) {
              throw new Error('expected FormData');
            }
            names.push(
              body.getAll('snapshots').map((item) => (item instanceof File ? item.name : '')),
            );
            if (names.length === 1) {
              return new Response('Request Entity Too Large', { status: 413 });
            }
            return new Response('{"ok":true}\n', { status: 202 });
          },
        },
      );

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(names).toHaveLength(2);
      expect(names[0]).toHaveLength(1);
      expect(names[1]).toHaveLength(1);
      expect(names[0]?.[0]).not.toBe(names[1]?.[0]);
      expect(result.out).toContain('Push failed:');
      expect(result.out).toContain('HTTP 413');
      expect(result.out).toContain('Attempted');
      expect(result.out).toContain('Pushed 1 snapshot');
      expect(await store.list()).toHaveLength(2);
      const accepted = (await pushState.load()).targets[0]?.accepted.map((item) => item.name);
      expect(accepted).toEqual(names[1]);
    });

    it('refuses --warn-only on watch', async () => {
      const result = await run([
        'watch',
        '--url',
        'redis://localhost:6379',
        '--snapshots',
        './snaps',
        '--fail-on-ttl-drop',
        '20',
        '--warn-only',
      ]);

      expect(result.exitCode).toBe(EXIT_CODES.usageError);
      expect(result.err).toContain('--warn-only');
    });
  });

  describe('push', () => {
    const argv = [
      'push',
      '--snapshots',
      './snaps',
      '--web-url',
      'https://app.example.com',
      '--instance',
      'inst-1',
      '--token',
      'rdp_secret',
    ] as const;

    it('exits zero when every batch is accepted and non-zero when one fails', async () => {
      const store = createMemorySnapshotStore(
        [
          snapshotFixture({ snapshotId: 'a', capturedAt: '2026-11-01T00:00:00.000Z' }),
          snapshotFixture({ snapshotId: 'b', capturedAt: '2026-11-01T01:00:00.000Z' }),
        ],
        './snaps',
      );
      const candidates = pushCandidatesFromStore(await store.list());
      const first = candidates[0];
      if (first === undefined) {
        throw new Error('expected a snapshot');
      }
      const oneFile = estimateMultipartBodyBytes([{ name: first.name, contents: first.contents }]);
      const flags = [...argv, '--push-max-bytes', String(oneFile)];

      const accepted = await run(flags, {
        openSnapshotStore: () => store,
        fetch: async () => new Response('{"ok":true}\n', { status: 202 }),
      });
      expect(accepted.exitCode).toBe(EXIT_CODES.ok);
      expect(accepted.out).toContain('Pushed 2 snapshots');
      expect(accepted.err).toBe('');

      const pushState = createMemoryPushStateStore();
      let calls = 0;
      const partial = await run(flags, {
        openSnapshotStore: () => store,
        openPushStateStore: () => pushState,
        fetch: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response('{"ok":true}\n', { status: 202 });
          }
          return new Response('Request Entity Too Large', { status: 413 });
        },
      });

      expect(partial.exitCode).toBe(EXIT_CODES.unexpectedError);
      expect(partial.err).toContain('Pushed 1 of 2 snapshots');
      expect(partial.err).toContain('1 failed');
      expect(partial.err).toContain('HTTP 413');
      expect(partial.err).toContain('Attempted');
      expect(partial.err).toContain(String(oneFile));
      expect((await pushState.load()).targets[0]?.accepted.map((item) => item.snapshotId)).toEqual([
        'a',
      ]);
    });
  });

  describe('test-alert', () => {
    it('sends one sample notification per configured channel', async () => {
      const posts: { url: string; body: string; headers: Readonly<Record<string, string>> }[] = [];

      const result = await run(
        [
          'test-alert',
          '--alert-webhook-url',
          'https://example.com/hook',
          '--alert-webhook-secret',
          's3cret',
          '--url',
          'redis://:hunter2@localhost:6379',
        ],
        {
          alertFetch: (url, init) => {
            posts.push({ url, body: init.body, headers: init.headers });
            return Promise.resolve({ status: 202, body: 'ok' });
          },
        },
      );

      expect(result.exitCode).toBe(EXIT_CODES.ok);
      expect(result.out).toContain('test-alert webhook: sent');
      expect(posts).toHaveLength(1);
      expect(posts[0]?.url).toBe('https://example.com/hook');
      expect(posts[0]?.headers['x-redis-detective-signature']).toMatch(/^sha256=[0-9a-f]+$/);
      expect(posts[0]?.body).toContain('session:*');
      expect(posts[0]?.body).not.toContain('hunter2');
      expect(result.out).not.toContain('hunter2');
      expect(result.out).not.toContain('s3cret');
    });

    it('accepts alerts test as an alias and refuses to run with no channel', async () => {
      const alias = await run(
        [
          'alerts',
          'test',
          '--alert-dry-run',
          '--alert-slack-webhook',
          'https://hooks.slack.com/services/T/B/x',
        ],
        {
          alertFetch: () => Promise.resolve({ status: 200, body: 'ok' }),
        },
      );
      expect(alias.exitCode).toBe(EXIT_CODES.ok);
      expect(alias.out).toContain('--- alert dry-run slack ---');

      const missing = await run(['test-alert']);
      expect(missing.exitCode).toBe(EXIT_CODES.usageError);
      expect(missing.err).toContain('channel');
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

const MIB = 1024 * 1024;

function storedSnapshot(
  snapshotId: string,
  capturedAt: string,
  bytes: number,
  patterns: ReturnType<typeof patternFixture>[],
) {
  return snapshotFixture({
    snapshotId,
    capturedAt,
    memory: {
      usedMemoryBytes: bytes,
      usedMemoryRssBytes: bytes,
      usedMemoryDatasetBytes: bytes,
      usedMemoryPeakBytes: bytes,
      memFragmentationRatio: 1.1,
      evictedKeys: 0,
      expiredKeys: 0,
    },
    keyspace: [{ db: 0, keyCount: 100_000, keysWithExpiry: 90_000, averageTtlMs: 3_600_000 }],
    patterns,
  });
}

function growingPatterns(
  sessionBytes: number,
  sessionKeys: number,
  cacheBytes: number,
  cacheKeys: number,
) {
  return [
    patternFixture({
      pattern: 'session:*',
      estimatedBytes: sessionBytes,
      estimatedKeyCount: sessionKeys,
      sampledKeyCount: 100,
      keysWithTtl: 100,
      keysWithoutTtl: 0,
      medianTtlSeconds: 3_600,
    }),
    patternFixture({
      pattern: 'cache:*',
      estimatedBytes: cacheBytes,
      estimatedKeyCount: cacheKeys,
      sampledKeyCount: 100,
      keysWithTtl: 80,
      keysWithoutTtl: 20,
      medianTtlSeconds: 3_600,
    }),
  ];
}

function largeInstanceSnapshots() {
  const start = 909 * MIB;
  const total = Math.round(46.9 * MIB);
  const at = [
    '2026-11-14T03:30:00.000Z',
    '2026-11-14T03:45:00.000Z',
    '2026-11-14T04:00:00.000Z',
    '2026-11-14T04:15:00.000Z',
    '2026-11-14T04:32:00.000Z',
  ];
  return at.map((capturedAt, index) => {
    const progress = index / 4;
    return storedSnapshot(
      `snapshot-${index + 1}`,
      capturedAt,
      start + Math.round((total * index) / 4),
      growingPatterns(
        Math.round((80 + 40 * progress) * MIB),
        Math.round(8_000 + 8_000 * progress),
        Math.round((8 + 2 * progress) * MIB),
        Math.round(1_000 + 100 * progress),
      ),
    );
  });
}

function belowThresholdSnapshots() {
  const at = ['2026-11-14T03:30:00.000Z', '2026-11-14T04:00:00.000Z', '2026-11-14T04:32:00.000Z'];
  const memory = [1000, 1005, 1010];
  return at.map((capturedAt, index) => {
    const progress = index / 2;
    return storedSnapshot(
      `snapshot-${index + 1}`,
      capturedAt,
      (memory[index] ?? 1000) * MIB,
      growingPatterns(
        Math.round((20 + 8 * progress) * MIB),
        Math.round(1_000 + 3_000 * progress),
        Math.round((5 + progress) * MIB),
        Math.round(1_000 + 50 * progress),
      ),
    );
  });
}
