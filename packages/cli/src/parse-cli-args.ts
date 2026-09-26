import {
  GITHUB_APP_ENV_VARS,
  GITHUB_PERSONAL_TOKEN_ENV_VARS,
} from '@redis-detective/github-integration';

import { commandFromArgv } from './command-from-argv.js';
import type { CliCommand } from './command-from-argv.js';
import { MIN_WATCH_INTERVAL_MS } from './watch-defaults.js';

export interface CliOptions {
  /** `report` runs once; `watch` keeps sampling on an interval. */
  readonly command: CliCommand;
  /** `null` when `--help` or `--version` was requested, or when no URL was supplied. */
  readonly redisUrl: string | null;
  readonly json: boolean;
  readonly sampleSize: number | null;
  readonly timeoutMs: number | null;
  /** `SAMPLES` for `MEMORY USAGE` on nested values. `null` leaves the sampler's default. */
  readonly memorySamples: number | null;
  readonly databases: readonly number[] | null;
  readonly redactKeys: boolean;
  /**
   * When true, personal GitHub credentials are `GITHUB_TOKEN` / `GH_TOKEN` only.
   * `gh auth token` is not consulted. A complete GitHub App environment is unchanged.
   */
  readonly skipGh: boolean;
  /**
   * Directory of snapshot files. When set, this run is a diagnosis: the sample is saved (if a URL
   * was given) and compared against whatever is already in the directory. `null` keeps the
   * single-snapshot health check.
   */
  readonly snapshotDirectory: string | null;
  /**
   * `owner/repo` to search for candidate commits. `null` when the user did not pass `--repo` and
   * no Connected-repository env fallback applied. Parsed later; this is the raw string.
   */
  readonly repository: string | null;
  /** Hours before the growth window to search. `null` means the seven-day default. */
  readonly lookbackHours: number | null;
  /** Milliseconds between `watch` samples. `null` means the watch default. */
  readonly intervalMs: number | null;
  readonly help: boolean;
  readonly version: boolean;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

interface MutableCliOptions {
  redisUrl: string | null;
  json: boolean;
  sampleSize: number | null;
  timeoutMs: number | null;
  memorySamples: number | null;
  databases: readonly number[] | null;
  redactKeys: boolean;
  skipGh: boolean;
  snapshotDirectory: string | null;
  repository: string | null;
  lookbackHours: number | null;
  intervalMs: number | null;
  help: boolean;
  version: boolean;
}

function parsePositiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliUsageError(`${flag} expects a positive integer, received "${raw}".`);
  }
  return value;
}

function parseNonNegativeInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new CliUsageError(`${flag} expects a non-negative integer, received "${raw}".`);
  }
  return value;
}

function unitToMs(unit: string): number {
  switch (unit) {
    case 'h':
      return 60 * 60 * 1_000;
    case 'm':
      return 60 * 1_000;
    default:
      return 1_000;
  }
}

/**
 * `45s`, `15m`, `2h`, or a bare number read as seconds.
 *
 * Seconds is the bare unit because that is what a number in a CLI duration most often means, and
 * a wrong guess here is cheap to correct: `--interval 900` and `--interval 15m` are the same
 * thing, while a misread of minutes-as-seconds would sample 60 times too often.
 */
function parseDurationMs(flag: string, raw: string): number {
  const match = /^(\d+)(s|m|h)?$/.exec(raw.trim());
  const digits = match?.[1];
  if (digits === undefined) {
    throw new CliUsageError(
      `${flag} expects a duration such as 45s, 15m or 2h, or a plain number of seconds, received "${raw}".`,
    );
  }
  return Number(digits) * unitToMs(match?.[2] ?? 's');
}

function parseWatchInterval(flag: string, raw: string): number {
  const intervalMs = parseDurationMs(flag, raw);
  if (intervalMs < MIN_WATCH_INTERVAL_MS) {
    throw new CliUsageError(
      `${flag} must be at least ${String(MIN_WATCH_INTERVAL_MS / 1_000)}s, so each bounded sample is followed by an idle gap. Received "${raw}".`,
    );
  }
  return intervalMs;
}

function parseDatabaseList(raw: string): readonly number[] {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (parts.length === 0) {
    throw new CliUsageError('--databases expects a comma-separated list of database indexes.');
  }

  return parts.map((part) => {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0) {
      throw new CliUsageError(`--databases expects non-negative integers, received "${part}".`);
    }
    return value;
  });
}

/**
 * Parses argv into `CliOptions`, without touching the network or the environment beyond `env`.
 *
 * Hand-rolled rather than pulled from a dependency: the flag surface is tiny, and a CLI people are
 * asked to run against production should have as few third-party packages in it as possible.
 *
 * A leading subcommand is split off by `commandFromArgv` before any flag is read, so every flag
 * means the same thing whichever command it follows.
 *
 * Note that `--sample-size` is only range-checked here as "a positive integer". Whether it is
 * *safe* is decided by `resolveSamplerOptions`, which clamps it. Duplicating the ceiling here would
 * risk the two drifting apart, and the sampler is the one that must not be bypassed.
 */
export function parseCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): CliOptions {
  const { command, flags } = commandFromArgv(argv);
  const options: MutableCliOptions = {
    redisUrl: null,
    json: false,
    sampleSize: null,
    timeoutMs: null,
    memorySamples: null,
    databases: null,
    redactKeys: false,
    skipGh: false,
    snapshotDirectory: null,
    repository: null,
    lookbackHours: null,
    intervalMs: null,
    help: false,
    version: false,
  };

  const takeValue = (
    flag: string,
    inlineValue: string | undefined,
    index: number,
  ): [string, number] => {
    if (inlineValue !== undefined) {
      return [inlineValue, index];
    }
    const next = flags[index + 1];
    if (next === undefined || next.startsWith('-')) {
      throw new CliUsageError(`${flag} expects a value.`);
    }
    return [next, index + 1];
  };

  for (let index = 0; index < flags.length; index += 1) {
    const argument = flags[index];
    if (argument === undefined) {
      continue;
    }

    const separator = argument.indexOf('=');
    const flag =
      argument.startsWith('--') && separator > -1 ? argument.slice(0, separator) : argument;
    const inlineValue =
      argument.startsWith('--') && separator > -1 ? argument.slice(separator + 1) : undefined;

    switch (flag) {
      case '-h':
      case '--help':
        options.help = true;
        break;

      case '-V':
      case '--version':
        options.version = true;
        break;

      case '--json':
        options.json = true;
        break;

      case '--redact-keys':
        options.redactKeys = true;
        break;

      case '--skip-gh':
        options.skipGh = true;
        break;

      case '--snapshots': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        if (value === '') {
          throw new CliUsageError('--snapshots expects a directory path.');
        }
        options.snapshotDirectory = value;
        index = nextIndex;
        break;
      }

      case '--repo': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        if (value === '') {
          throw new CliUsageError('--repo expects a repository as owner/repo.');
        }
        options.repository = value;
        index = nextIndex;
        break;
      }

      case '--lookback-hours': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        options.lookbackHours = parseNonNegativeInteger(flag, value);
        index = nextIndex;
        break;
      }

      case '--interval': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        options.intervalMs = parseWatchInterval(flag, value);
        index = nextIndex;
        break;
      }

      case '-u':
      case '--url': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        options.redisUrl = value;
        index = nextIndex;
        break;
      }

      case '--sample-size': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        options.sampleSize = parsePositiveInteger(flag, value);
        index = nextIndex;
        break;
      }

      case '--timeout': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        options.timeoutMs = parsePositiveInteger(flag, value);
        index = nextIndex;
        break;
      }

      case '--memory-samples': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        options.memorySamples = parsePositiveInteger(flag, value);
        index = nextIndex;
        break;
      }

      case '--databases': {
        const [value, nextIndex] = takeValue(flag, inlineValue, index);
        options.databases = parseDatabaseList(value);
        index = nextIndex;
        break;
      }

      default: {
        if (argument.startsWith('-')) {
          throw new CliUsageError(`Unknown option "${argument}". Run with --help for usage.`);
        }
        if (options.redisUrl !== null) {
          throw new CliUsageError(`Unexpected argument "${argument}".`);
        }
        options.redisUrl = argument;
      }
    }
  }

  if (options.redisUrl === null) {
    options.redisUrl = env['REDIS_URL'] ?? null;
  }

  if (!options.skipGh) {
    const skipGh = env['REDIS_DETECTIVE_SKIP_GH']?.trim().toLowerCase();
    options.skipGh = skipGh === '1' || skipGh === 'true';
  }

  if (options.repository === null && options.snapshotDirectory !== null) {
    options.repository = repositoryFallbackFromEnv(env);
  }

  return { command, ...options };
}

/**
 * `GITHUB_REPOSITORY` is treated as a Connected repository only when some GitHub credential
 * signal is also present (App id, or a personal token env var). GitHub Actions sets
 * `GITHUB_REPOSITORY` on every job; using it alone would turn a Redis diagnosis into a failed
 * GitHub auth. `gh auth token` is not checked here — parsing is sync.
 */
function repositoryFallbackFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const fromEnv = env['GITHUB_REPOSITORY']?.trim();
  if (fromEnv === undefined || fromEnv === '') {
    return null;
  }

  const appId = env[GITHUB_APP_ENV_VARS.appId]?.trim();
  const githubToken = env[GITHUB_PERSONAL_TOKEN_ENV_VARS.githubToken]?.trim();
  const ghToken = env[GITHUB_PERSONAL_TOKEN_ENV_VARS.ghToken]?.trim();
  const hasCredentialSignal =
    (appId !== undefined && appId !== '') ||
    (githubToken !== undefined && githubToken !== '') ||
    (ghToken !== undefined && ghToken !== '');

  return hasCredentialSignal ? fromEnv : null;
}
