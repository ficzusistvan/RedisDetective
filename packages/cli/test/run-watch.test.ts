import { describe, expect, it } from 'vitest';

import { createMemorySnapshotStore, runWatch } from '@redis-detective/cli';
import type { RunWatchRequest, SnapshotStore, WatchDeps } from '@redis-detective/cli';
import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';

import { snapshotFixture } from './helpers/snapshot-builder.js';

const INTERVAL_MS = 15 * 60 * 1_000;

function instance(): FakeRedisCommandClient {
  return new FakeRedisCommandClient({
    databases: { 0: fakeKeys('cart:items:', 100, { bytes: 4_096 }) },
  });
}

/**
 * A watch request whose clock advances an hour per tick, so tick lines are pinned.
 *
 * The loop runs until `stop` aborts, so every test here supplies deps that abort — a test that
 * forgot would otherwise wait on a real 15-minute timer.
 */
function watchRequest(
  stop: AbortController,
  overrides: Partial<RunWatchRequest> = {},
): RunWatchRequest {
  let ticks = 0;
  return {
    store: createMemorySnapshotStore(),
    client: instance(),
    target: 'redis://redis.example.com:6379',
    intervalMs: INTERVAL_MS,
    sampleSize: null,
    timeoutMs: null,
    memorySamples: null,
    databases: null,
    redactKeys: false,
    repository: null,
    now: () => {
      const at = new Date(Date.UTC(2026, 7, 25, 10 + ticks, 0, 0));
      ticks += 1;
      return at;
    },
    stopSignal: stop.signal,
    writeLine: () => undefined,
    ...overrides,
  };
}

/** Records each sleep and stops the loop once `stopAfter` of them have been asked for. */
function stopAfterIntervals(
  stop: AbortController,
  stopAfter: number,
  waits: number[],
): WatchDeps {
  return {
    wait: (ms) => {
      waits.push(ms);
      if (waits.length >= stopAfter) {
        stop.abort();
      }
      return Promise.resolve();
    },
  };
}

describe('runWatch', () => {
  it('takes one sample per interval until it is told to stop', async () => {
    const stop = new AbortController();
    const waits: number[] = [];

    const summary = await runWatch(
      watchRequest(stop),
      stopAfterIntervals(stop, 3, waits),
    );

    expect(summary.snapshotsTaken).toBe(3);
    expect(summary.snapshotsInStore).toBe(3);
    expect(waits).toEqual([INTERVAL_MS, INTERVAL_MS, INTERVAL_MS]);
  });

  it('prints one line per sample rather than the report', async () => {
    const stop = new AbortController();
    const lines: string[] = [];

    await runWatch(
      watchRequest(stop, { writeLine: (line) => lines.push(line) }),
      stopAfterIntervals(stop, 2, []),
    );
    const ticks = lines.filter((line) => line.startsWith('2026-'));

    expect(ticks).toEqual([
      '2026-08-25T10:00:00.000Z  100 keys sampled  64.0 MB used  1 snapshot so far, nothing to compare yet',
      '2026-08-25T11:00:00.000Z  100 keys sampled  64.0 MB used  no named cause',
    ]);
    // The things a full report would carry, which would flood a session running for days.
    expect(lines.join('\n')).not.toContain('Limitations');
    expect(lines.join('\n')).not.toContain('Latest snapshot');
  });

  it('counts snapshots left by earlier sessions in the closing summary', async () => {
    const stop = new AbortController();
    const lines: string[] = [];
    const store = createMemorySnapshotStore([
      snapshotFixture({ snapshotId: 'earlier-session', capturedAt: '2026-08-24T10:00:00.000Z' }),
    ]);

    const summary = await runWatch(
      watchRequest(stop, { store, writeLine: (line) => lines.push(line) }),
      stopAfterIntervals(stop, 1, []),
    );

    expect(summary.snapshotsTaken).toBe(1);
    expect(summary.snapshotsInStore).toBe(2);
    expect(lines.at(-2)).toContain('1 sample(s) taken this session; memory now holds 2.');
    expect(lines.at(-1)).toBe('Full diagnosis: redis-detective --snapshots memory');
  });

  it('finishes the sample in flight when interrupted, leaving a whole snapshot behind', async () => {
    const stop = new AbortController();
    const inner = createMemorySnapshotStore();
    const waits: number[] = [];
    // Interrupts the session while a sample is being saved, which is the case that must not be
    // able to leave a partial snapshot in the directory.
    const store: SnapshotStore = {
      describe: inner.describe,
      list: () => inner.list(),
      save: (snapshot) => {
        stop.abort();
        return inner.save(snapshot);
      },
    };

    const summary = await runWatch(
      watchRequest(stop, { store }),
      stopAfterIntervals(stop, 1, waits),
    );
    const stored = await inner.list();

    expect(summary.snapshotsTaken).toBe(1);
    expect(waits).toEqual([]);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.snapshot.patterns[0]?.pattern).toBe('cart:items:*');
    expect(stored[0]?.snapshot.sampling.observedSampleSize).toBe(100);
  });

  it('passes the sampling flags through on every tick', async () => {
    const stop = new AbortController();
    const client = instance();
    const store = createMemorySnapshotStore();

    await runWatch(
      watchRequest(stop, { client, store, sampleSize: 20, memorySamples: 2 }),
      stopAfterIntervals(stop, 2, []),
    );
    const stored = await store.list();
    const memoryCalls = client.issuedCommands.filter((command) =>
      command.startsWith('MEMORY USAGE'),
    );

    expect(stored).toHaveLength(2);
    // Requested, not observed: the sampler's own rate cap decides what a request of 20 yields.
    expect(stored.map((entry) => entry.snapshot.sampling.requestedSampleSize)).toEqual([20, 20]);
    expect(memoryCalls.length).toBeGreaterThan(0);
    expect(memoryCalls.every((command) => command.endsWith('SAMPLES 2'))).toBe(true);
  });

  it('says up front that a repository is not queried while watching', async () => {
    const stop = new AbortController();
    const lines: string[] = [];

    await runWatch(
      watchRequest(stop, {
        repository: 'acme/checkout',
        writeLine: (line) => lines.push(line),
      }),
      stopAfterIntervals(stop, 1, []),
    );
    const printed = lines.join('\n');

    expect(lines[0]).toBe(
      'Watching redis://redis.example.com:6379 every 15m, saving to memory.',
    );
    expect(printed).toContain('makes no GitHub requests');
    expect(lines.at(-1)).toBe(
      'Full diagnosis: redis-detective --snapshots memory --repo acme/checkout',
    );
  });
});
