import { describe, expect, it } from 'vitest';

import { sampleRedisState } from '@redis-detective/sampler';
import type { SampleRedisStateDeps } from '@redis-detective/sampler';

import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';

const BASE_MS = Date.UTC(2026, 7, 25, 10, 0, 0);

function deterministicDeps(client: FakeRedisCommandClient): SampleRedisStateDeps {
  return {
    now: () => new Date(BASE_MS + client.now()),
    newSnapshotId: () => 'snapshot-fixed',
    random: () => 0,
  };
}

describe('sampleRedisState', () => {
  it('assembles a complete snapshot from INFO and a bounded sample', async () => {
    const client = new FakeRedisCommandClient({
      databases: {
        0: {
          'session:1': { ttlMs: 60_000, bytes: 200 },
          'session:2': { ttlMs: 60_000, bytes: 200 },
          'cart:items:9': { type: 'hash', bytes: 4_096 },
          config: { bytes: 64 },
        },
      },
    });

    const snapshot = await sampleRedisState(client, {}, deterministicDeps(client));

    expect(snapshot.snapshotId).toBe('snapshot-fixed');
    expect(snapshot.capturedAt).toBe('2026-08-25T10:00:00.000Z');
    expect(snapshot.instance.redisVersion).toBe('7.2.4');
    expect(snapshot.instance.maxmemoryBytes).toBe(536_870_912);
    expect(snapshot.memory.usedMemoryBytes).toBe(67_108_864);
    expect(snapshot.keyspace).toEqual([
      { db: 0, keyCount: 4, keysWithExpiry: 2, averageTtlMs: 3_600_000 },
    ]);
    expect(snapshot.sampling.observedSampleSize).toBe(4);
    expect(snapshot.sampling.truncated).toBe(false);
  });

  it('attributes the largest pattern first', async () => {
    const client = new FakeRedisCommandClient({
      databases: {
        0: {
          'cart:items:1': { type: 'hash', bytes: 8_192 },
          'session:1': { bytes: 100 },
          'session:2': { bytes: 100 },
        },
      },
    });

    const snapshot = await sampleRedisState(client, {}, deterministicDeps(client));

    expect(snapshot.patterns[0]?.pattern).toBe('cart:items:*');
    expect(snapshot.patterns[0]?.estimatedBytes).toBe(8_192);
  });

  it('reports the effective sample rate against the real key space', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('session:', 1_000) } });

    const snapshot = await sampleRedisState(
      client,
      { maxSampledKeys: 100 },
      deterministicDeps(client),
    );

    expect(snapshot.sampling.observedSampleSize).toBe(100);
    expect(snapshot.sampling.effectiveSampleRate).toBeCloseTo(0.1, 5);
    expect(snapshot.patterns[0]?.estimateBasis).toBe('sampled-extrapolation');
  });

  // A user who asked for a bigger sample than allowed must be told they did not get it.
  it('surfaces clamped options as warnings rather than swallowing them', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('session:', 20) } });

    const snapshot = await sampleRedisState(
      client,
      { maxSampledKeys: 5_000_000 },
      deterministicDeps(client),
    );

    expect(snapshot.sampling.warnings.join(' ')).toContain('maxSampledKeys');
    expect(snapshot.sampling.requestedSampleSize).toBe(10_000);
  });

  it('rejects structurally invalid options before issuing any command', async () => {
    const client = new FakeRedisCommandClient();

    await expect(
      sampleRedisState(client, { maxSampledKeys: -1 }, deterministicDeps(client)),
    ).rejects.toThrow(/maxSampledKeys/);
    expect(client.issuedCommands).toEqual([]);
  });

  it('produces the same snapshot twice for the same instance state', async () => {
    const databases = { 0: fakeKeys('session:', 10, { ttlMs: 60_000, bytes: 128 }) };
    const first = new FakeRedisCommandClient({ databases });
    const second = new FakeRedisCommandClient({ databases });

    expect(await sampleRedisState(first, {}, deterministicDeps(first))).toEqual(
      await sampleRedisState(second, {}, deterministicDeps(second)),
    );
  });

  it('survives an instance that blocks MEMORY USAGE', async () => {
    const client = new FakeRedisCommandClient({
      databases: { 0: fakeKeys('session:', 5) },
      memoryUsageBlocked: true,
    });

    const snapshot = await sampleRedisState(client, {}, deterministicDeps(client));

    expect(snapshot.patterns[0]?.bytesMeasured).toBe(false);
    expect(snapshot.patterns[0]?.estimatedKeyCount).toBe(5);
    expect(snapshot.sampling.warnings.join(' ')).toContain('MEMORY USAGE is unavailable');
  });

  it('warns when used_memory is 0 and the keyspace still has keys', async () => {
    const client = new FakeRedisCommandClient({
      info: ['used_memory:0', 'db0:keys=2,expires=0,avg_ttl=0'].join('\r\n'),
      databases: {
        0: {
          'session:1': { bytes: 10 },
          'session:2': { bytes: 10 },
        },
      },
    });

    const snapshot = await sampleRedisState(client, {}, deterministicDeps(client));

    expect(snapshot.memory.usedMemoryBytes).toBe(0);
    expect(snapshot.keyspace[0]?.keyCount).toBe(2);
    expect(snapshot.sampling.warnings.join(' ')).toContain('resident memory, not an empty dataset');
  });

  it('does not warn when used_memory is 0 and the keyspace is empty', async () => {
    const client = new FakeRedisCommandClient({
      info: 'used_memory:0\r\n',
      databases: { 0: {} },
    });

    const snapshot = await sampleRedisState(client, {}, deterministicDeps(client));

    expect(snapshot.memory.usedMemoryBytes).toBe(0);
    expect(snapshot.sampling.warnings.join(' ')).not.toContain('resident memory');
  });

  it('records a missing used_memory as unknown and says so', async () => {
    const client = new FakeRedisCommandClient({
      info: 'db0:keys=1,expires=0,avg_ttl=0\r\n',
      databases: { 0: { 'session:1': { bytes: 10 } } },
    });

    const snapshot = await sampleRedisState(client, {}, deterministicDeps(client));

    expect(snapshot.memory.usedMemoryBytes).toBeNull();
    expect(snapshot.sampling.warnings.join(' ')).toContain('absent from INFO');
  });

  it('handles an empty instance', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: {} } });

    const snapshot = await sampleRedisState(client, {}, deterministicDeps(client));

    expect(snapshot.patterns).toEqual([]);
    expect(snapshot.sampling.observedSampleSize).toBe(0);
    expect(snapshot.sampling.effectiveSampleRate).toBe(0);
  });
});
