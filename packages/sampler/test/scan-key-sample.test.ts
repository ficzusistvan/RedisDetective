import { describe, expect, it } from 'vitest';

import { resolveSamplerOptions, scanKeySample } from '@redis-detective/sampler';
import type { ResolvedSamplerOptions, ScanKeySampleDeps } from '@redis-detective/sampler';

import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';
import type { FakeRedisOptions } from '@redis-detective/sampler/testing';

const FORBIDDEN_COMMANDS = [
  'KEYS',
  'FLUSHDB',
  'FLUSHALL',
  'EVAL',
  'DEBUG',
  'DEL',
  'RANDOMKEY',
  'MEMORY STATS',
  'MEMORY DOCTOR',
];

function fixture(
  fakeOptions: FakeRedisOptions,
  samplerOptions: Parameters<typeof resolveSamplerOptions>[0] = {},
  random = 0,
): {
  client: FakeRedisCommandClient;
  options: ResolvedSamplerOptions;
  deps: ScanKeySampleDeps;
} {
  const client = new FakeRedisCommandClient(fakeOptions);
  return {
    client,
    options: resolveSamplerOptions(samplerOptions),
    deps: { now: () => client.now(), random: () => random },
  };
}

describe('scanKeySample', () => {
  it('visits a small key space in full and reports it as exact', async () => {
    const { client, options, deps } = fixture({
      databases: { 0: { 'session:1': { ttlMs: 60_000 }, 'session:2': {}, config: {} } },
    });

    const result = await scanKeySample(client, options, deps);

    expect(result.keys).toHaveLength(3);
    expect(result.keyspaceSize).toBe(3);
    expect(result.exhaustive).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('records type, TTL and size for each sampled key', async () => {
    const { client, options, deps } = fixture({
      databases: { 0: { 'cart:1': { type: 'hash', ttlMs: 30_000, bytes: 2_048 } } },
    });

    const result = await scanKeySample(client, options, deps);

    expect(result.keys[0]).toEqual({
      key: 'cart:1',
      db: 0,
      dataType: 'hash',
      serializedBytes: 2_048,
      ttlMs: 30_000,
    });
  });

  it('represents a key with no expiry as a null TTL', async () => {
    const { client, options, deps } = fixture({ databases: { 0: { 'leak:1': { ttlMs: null } } } });

    const result = await scanKeySample(client, options, deps);

    expect(result.keys[0]?.ttlMs).toBeNull();
  });

  // ---------------------------------------------------------------------------------------
  // Hard rule 1 (packages/sampler/AGENTS.md). These four assertions are the reason the fake
  // records commands at all: without them the bounds are only a comment.
  // ---------------------------------------------------------------------------------------

  it('stops at the key ceiling instead of walking the key space', async () => {
    const { client, options, deps } = fixture(
      { databases: { 0: fakeKeys('session:', 500) } },
      { maxSampledKeys: 10 },
    );

    const result = await scanKeySample(client, options, deps);

    expect(result.keys).toHaveLength(10);
    expect(result.keyspaceSize).toBe(500);
    expect(result.exhaustive).toBe(false);
    // The expensive per-key command ran ten times, not five hundred.
    expect(client.countCommands('MEMORY USAGE')).toBe(10);
  });

  it('stops at the scan-pass ceiling', async () => {
    const { client, options, deps } = fixture(
      { databases: { 0: fakeKeys('session:', 100) } },
      { maxScanPasses: 2, scanCount: 1 },
    );

    const result = await scanKeySample(client, options, deps);

    expect(client.countCommands('SCAN')).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(' ')).toContain('pass ceiling');
  });

  it('stops at the wall-clock deadline', async () => {
    const { client, options, deps } = fixture(
      { databases: { 0: fakeKeys('session:', 100) }, msPerCommand: 10 },
      { maxDurationMs: 100, scanCount: 2 },
    );

    const result = await scanKeySample(client, options, deps);

    expect(result.truncated).toBe(true);
    expect(result.keys.length).toBeLessThan(100);
    expect(result.warnings.join(' ')).toContain('deadline');
  });

  it('caps the sampled fraction of a large key space', async () => {
    const { client, options, deps } = fixture(
      { databases: { 0: fakeKeys('session:', 2_000) } },
      { maxSampledKeys: 1_000, maxSampleRate: 0.1 },
    );

    const result = await scanKeySample(client, options, deps);

    expect(result.keys).toHaveLength(200);
  });

  it('issues no forbidden command, ever', async () => {
    const { client, options, deps } = fixture(
      { databases: { 0: fakeKeys('session:', 50), 1: fakeKeys('cart:', 20) } },
      { databases: [0, 1] },
    );

    await scanKeySample(client, options, deps);

    for (const forbidden of FORBIDDEN_COMMANDS) {
      expect(client.countCommands(forbidden)).toBe(0);
    }
    expect(client.countCommands('SCAN')).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------------------

  it('degrades to a snapshot without byte figures when MEMORY USAGE is blocked', async () => {
    const { client, options, deps } = fixture({
      databases: { 0: fakeKeys('session:', 5) },
      memoryUsageBlocked: true,
    });

    const result = await scanKeySample(client, options, deps);

    expect(result.keys).toHaveLength(5);
    expect(result.keys.every((key) => key.serializedBytes === null)).toBe(true);
    expect(result.warnings.join(' ')).toContain('MEMORY USAGE is unavailable');
    // Asked once, learned it was blocked, stopped asking.
    expect(client.countCommands('MEMORY USAGE')).toBe(1);
  });

  it('skips keys that expired between SCAN and TYPE', async () => {
    const { client, options, deps } = fixture({
      databases: { 0: { 'session:1': {}, 'session:2': { type: 'none' }, 'session:3': {} } },
    });

    const result = await scanKeySample(client, options, deps);

    expect(result.keys.map((key) => key.key)).toEqual(['session:1', 'session:3']);
    expect(result.exhaustive).toBe(false);
  });

  it('wraps to the start when a random cursor lands past the end of the table', async () => {
    // random ≈ 1 puts the start cursor in the last bucket of the table.
    const { client, options, deps } = fixture(
      { databases: { 0: fakeKeys('session:', 200) } },
      { maxSampledKeys: 20 },
      0.99,
    );

    const result = await scanKeySample(client, options, deps);

    expect(result.keys).toHaveLength(20);
  });

  it('samples every requested database', async () => {
    const { client, options, deps } = fixture(
      { databases: { 0: fakeKeys('a:', 40), 2: fakeKeys('b:', 40) } },
      { databases: [0, 2], maxSampledKeys: 20 },
    );

    const result = await scanKeySample(client, options, deps);

    expect(result.keyspaceSize).toBe(80);
    expect(new Set(result.keys.map((key) => key.db))).toEqual(new Set([0, 2]));
    expect(result.keys.length).toBeLessThanOrEqual(20);
  });

  it('handles an empty instance without warnings about a missing sample', async () => {
    const { client, options, deps } = fixture({ databases: { 0: {} } });

    const result = await scanKeySample(client, options, deps);

    expect(result.keys).toEqual([]);
    expect(result.keyspaceSize).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});
