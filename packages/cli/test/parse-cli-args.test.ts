import { describe, expect, it } from 'vitest';

import { CliUsageError, parseCliArgs } from '@redis-detective/cli';

describe('parseCliArgs --skip-gh', () => {
  it('defaults to consulting gh, and turns that off from the flag or the env', () => {
    expect(parseCliArgs([], {}).skipGh).toBe(false);
    expect(parseCliArgs(['--skip-gh'], {}).skipGh).toBe(true);
    expect(parseCliArgs([], { REDIS_DETECTIVE_SKIP_GH: '1' }).skipGh).toBe(true);
    expect(parseCliArgs([], { REDIS_DETECTIVE_SKIP_GH: 'true' }).skipGh).toBe(true);
    expect(parseCliArgs([], { REDIS_DETECTIVE_SKIP_GH: '0' }).skipGh).toBe(false);
  });
});

describe('parseCliArgs --redact-keys', () => {
  it('defaults to off and is enabled by the flag', () => {
    expect(parseCliArgs([], {}).redactKeys).toBe(false);
    expect(parseCliArgs(['--redact-keys'], {}).redactKeys).toBe(true);
  });
});

describe('parseCliArgs', () => {
  it('defaults to no URL and text output', () => {
    const options = parseCliArgs([]);

    expect(options.command).toBe('report');
    expect(options.redisUrl).toBeNull();
    expect(options.json).toBe(false);
    expect(options.sampleSize).toBeNull();
    expect(options.intervalMs).toBeNull();
    expect(options.help).toBe(false);
  });

  it('reads a leading watch subcommand without losing the flags after it', () => {
    const options = parseCliArgs([
      'watch',
      '--url',
      'redis://a:6379',
      '--snapshots',
      './snaps',
      '--interval',
      '15m',
    ]);

    expect(options.command).toBe('watch');
    expect(options.redisUrl).toBe('redis://a:6379');
    expect(options.snapshotDirectory).toBe('./snaps');
    expect(options.intervalMs).toBe(900_000);
  });

  it('reads an interval as seconds, minutes or hours, and a bare number as seconds', () => {
    expect(parseCliArgs(['--interval', '45s']).intervalMs).toBe(45_000);
    expect(parseCliArgs(['--interval', '15m']).intervalMs).toBe(900_000);
    expect(parseCliArgs(['--interval', '2h']).intervalMs).toBe(7_200_000);
    expect(parseCliArgs(['--interval=900']).intervalMs).toBe(900_000);
  });

  // The interval is the only gap between two bounded scans, so it is not allowed to vanish.
  it('rejects an interval below the floor, and one it cannot read', () => {
    expect(() => parseCliArgs(['--interval', '1'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--interval', '9s'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--interval', 'often'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--interval', '15 minutes'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--interval', '15d'])).toThrow(CliUsageError);
  });

  // Recognised in first position only, so a URL or a value can never be eaten as a command.
  it('treats a later "watch" as an argument rather than a command', () => {
    expect(parseCliArgs(['watch']).command).toBe('watch');
    expect(parseCliArgs(['--url', 'redis://a:6379']).command).toBe('report');
    expect(() => parseCliArgs(['--url', 'redis://a:6379', 'watch'])).toThrow(CliUsageError);
  });

  it('reads the URL from --url, -u, --url=value and a bare positional', () => {
    expect(parseCliArgs(['--url', 'redis://a:6379']).redisUrl).toBe('redis://a:6379');
    expect(parseCliArgs(['-u', 'redis://b:6379']).redisUrl).toBe('redis://b:6379');
    expect(parseCliArgs(['--url=redis://c:6379']).redisUrl).toBe('redis://c:6379');
    expect(parseCliArgs(['redis://d:6379']).redisUrl).toBe('redis://d:6379');
  });

  it('falls back to REDIS_URL only when no URL was passed', () => {
    expect(parseCliArgs([], { REDIS_URL: 'redis://env:6379' }).redisUrl).toBe('redis://env:6379');
    expect(
      parseCliArgs(['--url', 'redis://flag:6379'], { REDIS_URL: 'redis://env:6379' }).redisUrl,
    ).toBe('redis://flag:6379');
  });

  it('parses the sampling flags', () => {
    const options = parseCliArgs([
      '--url',
      'redis://a:6379',
      '--json',
      '--sample-size',
      '500',
      '--timeout',
      '2000',
      '--memory-samples',
      '3',
      '--databases',
      '0,2,1',
    ]);

    expect(options.json).toBe(true);
    expect(options.sampleSize).toBe(500);
    expect(options.timeoutMs).toBe(2_000);
    expect(options.memorySamples).toBe(3);
    expect(options.databases).toEqual([0, 2, 1]);
  });

  it('recognises --snapshots and rejects an empty path', () => {
    expect(parseCliArgs(['--snapshots', './snaps']).snapshotDirectory).toBe('./snaps');
    expect(parseCliArgs(['--snapshots=./snaps']).snapshotDirectory).toBe('./snaps');
    expect(parseCliArgs([]).snapshotDirectory).toBeNull();
    expect(() => parseCliArgs(['--snapshots'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--snapshots='])).toThrow(CliUsageError);
  });

  it('recognises --repo and --lookback-hours', () => {
    expect(parseCliArgs(['--repo', 'acme/checkout']).repository).toBe('acme/checkout');
    expect(parseCliArgs(['--repo=acme/checkout']).repository).toBe('acme/checkout');
    expect(parseCliArgs(['--lookback-hours', '24']).lookbackHours).toBe(24);
    expect(parseCliArgs(['--lookback-hours', '0']).lookbackHours).toBe(0);
    expect(parseCliArgs([]).repository).toBeNull();
    expect(parseCliArgs([]).lookbackHours).toBeNull();
    expect(() => parseCliArgs(['--repo'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--lookback-hours', '-1'])).toThrow(CliUsageError);
  });

  it('falls back to GITHUB_REPOSITORY during diagnosis when a credential signal is present', () => {
    expect(
      parseCliArgs(['--snapshots', './snaps'], {
        GITHUB_REPOSITORY: 'acme/from-env',
        GITHUB_APP_ID: '42',
      }).repository,
    ).toBe('acme/from-env');
    expect(
      parseCliArgs(['--snapshots', './snaps'], {
        GITHUB_REPOSITORY: 'acme/from-env',
        GITHUB_TOKEN: 'ghs_example',
      }).repository,
    ).toBe('acme/from-env');
    expect(
      parseCliArgs(['--snapshots', './snaps'], { GITHUB_REPOSITORY: 'acme/from-env' }).repository,
    ).toBeNull();
    expect(
      parseCliArgs(['--url', 'redis://a:6379'], {
        GITHUB_REPOSITORY: 'acme/from-env',
        GITHUB_APP_ID: '42',
      }).repository,
    ).toBeNull();
    expect(
      parseCliArgs(['--snapshots', './snaps', '--repo', 'acme/flag'], {
        GITHUB_REPOSITORY: 'acme/from-env',
        GITHUB_APP_ID: '42',
      }).repository,
    ).toBe('acme/flag');
  });

  it('recognises help and version in short and long form', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--version']).version).toBe(true);
    expect(parseCliArgs(['-V']).version).toBe(true);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => parseCliArgs(['--url'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--nope'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--sample-size', 'lots'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--sample-size', '0'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--sample-size', '1.5'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--timeout', '-5'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--memory-samples', '0'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--memory-samples', 'some'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--databases', 'x'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--databases', ''])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['redis://a:6379', 'redis://b:6379'])).toThrow(CliUsageError);
  });

  // Range enforcement belongs to resolveSamplerOptions, which clamps. Duplicating the ceiling
  // here would let the two drift apart.
  it('accepts an oversized sample size and leaves clamping to the sampler', () => {
    expect(parseCliArgs(['--sample-size', '5000000']).sampleSize).toBe(5_000_000);
  });
});
