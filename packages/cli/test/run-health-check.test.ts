import { describe, expect, it } from 'vitest';

import { REDACTED_KEY, redactExampleKeys, runHealthCheck } from '@redis-detective/cli';
import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';

import { patternFixture, snapshotFixture } from './helpers/snapshot-builder.js';

function request(client: FakeRedisCommandClient, overrides: Record<string, unknown> = {}) {
  return {
    client,
    target: 'redis://redis.example.com:6379',
    sampleSize: null,
    timeoutMs: null,
    memorySamples: null,
    databases: null,
    redactKeys: false,
    generatedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('runHealthCheck', () => {
  it('samples the instance and derives findings from it', async () => {
    const client = new FakeRedisCommandClient({
      databases: {
        0: {
          ...fakeKeys('cart:items:', 200, { bytes: 4_096 }),
          ...fakeKeys('session:', 200, { bytes: 128, ttlMs: 3_600_000 }),
        },
      },
    });

    const report = await runHealthCheck(request(client));

    expect(report.generatedAt).toBe('2026-08-25T10:00:00.000Z');
    expect(report.target).toBe('redis://redis.example.com:6379');
    expect(report.snapshot.patterns[0]?.pattern).toBe('cart:items:*');
    expect(report.findings.map((finding) => finding.kind)).toContain('no-ttl-coverage');
  });

  it('forwards the requested sample size to the sampler', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('session:', 5_000) } });

    const report = await runHealthCheck(request(client, { sampleSize: 300 }));

    expect(report.snapshot.sampling.observedSampleSize).toBe(300);
  });

  it('forwards the requested MEMORY USAGE samples to the sampler', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('session:', 10) } });

    await runHealthCheck(request(client, { memorySamples: 2 }));

    expect(client.issuedCommands).toContain('MEMORY USAGE session:0 SAMPLES 2');
  });

  // Two copies of a safety limit is how they drift apart, so the CLI does not re-check them.
  it('leaves the safety bounds to the sampler, which clamps and reports it', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('session:', 100) } });

    const report = await runHealthCheck(request(client, { sampleSize: 10_000_000 }));

    expect(report.caveats.join(' ')).toContain('maxSampledKeys');
  });

  it('clamps an over-ambitious --memory-samples in the sampler, not in the CLI', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('session:', 10) } });

    const report = await runHealthCheck(request(client, { memorySamples: 500 }));

    expect(report.caveats.join(' ')).toContain('memoryUsageSamples');
    expect(client.issuedCommands).toContain('MEMORY USAGE session:0 SAMPLES 10');
  });

  it('leaves example key names alone by default', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('user:', 100) } });

    const report = await runHealthCheck(request(client));

    expect(report.snapshot.patterns[0]?.exampleKeys[0]).toBe('user:0');
  });

  it('redacts example key names, in the findings as well as the snapshot', async () => {
    const client = new FakeRedisCommandClient({
      databases: { 0: fakeKeys('user:', 100, { bytes: 4_096 }) },
    });

    const report = await runHealthCheck(request(client, { redactKeys: true }));

    expect(report.snapshot.patterns[0]?.exampleKeys).toEqual([REDACTED_KEY]);
    for (const finding of report.findings) {
      expect(finding.detail).not.toMatch(/user:\d/);
    }
  });

  it('issues no forbidden command', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: fakeKeys('session:', 200) } });

    await runHealthCheck(request(client));

    for (const forbidden of ['KEYS', 'FLUSHDB', 'FLUSHALL', 'EVAL', 'DEL', 'DEBUG', 'RANDOMKEY']) {
      expect(client.countCommands(forbidden)).toBe(0);
    }
  });

  it('produces a report for an empty instance', async () => {
    const client = new FakeRedisCommandClient({ databases: { 0: {} } });

    const report = await runHealthCheck(request(client));

    expect(report.snapshot.patterns).toEqual([]);
    expect(report.findings).toEqual([]);
  });
});

describe('redactExampleKeys', () => {
  it('replaces example keys with a placeholder', () => {
    const snapshot = snapshotFixture({ patterns: [patternFixture()] });

    expect(redactExampleKeys(snapshot).patterns[0]?.exampleKeys).toEqual([REDACTED_KEY]);
  });

  it('leaves every other figure untouched', () => {
    const snapshot = snapshotFixture({ patterns: [patternFixture()] });
    const redacted = redactExampleKeys(snapshot);

    expect(redacted.patterns[0]?.pattern).toBe('session:*');
    expect(redacted.patterns[0]?.estimatedBytes).toBe(51_200_000);
    expect(redacted.memory).toEqual(snapshot.memory);
  });

  it('is pure', () => {
    const snapshot = snapshotFixture({ patterns: [patternFixture()] });
    redactExampleKeys(snapshot);

    expect(snapshot.patterns[0]?.exampleKeys).toEqual(['session:aaa111', 'session:bbb222']);
  });

  it('leaves a pattern with no examples alone', () => {
    const snapshot = snapshotFixture({ patterns: [patternFixture({ exampleKeys: [] })] });

    expect(redactExampleKeys(snapshot).patterns[0]?.exampleKeys).toEqual([]);
  });
});
