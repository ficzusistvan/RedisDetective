import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PUSH_MAX_AGE_MS,
  DEFAULT_PUSH_MAX_BYTES,
  createFilePushStateStore,
  createMemoryPushStateStore,
  estimateMultipartBodyBytes,
  runSnapshotPush,
} from '@redis-detective/cli';
import type { FetchLike, PushCandidate, PushStateStore, PushTarget } from '@redis-detective/cli';

const TARGET: PushTarget = {
  webUrl: 'https://app.example.com/',
  instanceId: 'inst-1',
  token: 'rdp_secret',
};

const NOW = new Date('2026-11-17T00:00:00.000Z');

function candidate(
  id: string,
  capturedAt = '2026-11-01T00:00:00.000Z',
  bytes = 1000,
): PushCandidate {
  return {
    snapshotId: id,
    capturedAt,
    name: `${id}.snapshot.json`,
    contents: 'x'.repeat(bytes),
  };
}

async function fileNames(body: RequestInit['body']): Promise<string[]> {
  if (!(body instanceof FormData)) {
    throw new Error('expected FormData');
  }
  return body.getAll('snapshots').map((item) => (item instanceof File ? item.name : ''));
}

function recordingFetch(statuses: readonly number[]): {
  readonly fetchImpl: FetchLike;
  readonly calls: string[][];
} {
  const calls: string[][] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    calls.push(await fileNames(init?.body));
    const status = statuses[calls.length - 1] ?? 202;
    const body = status === 413 ? 'Request Entity Too Large' : '{"ok":true}\n';
    return new Response(body, { status });
  };
  return { fetchImpl, calls };
}

async function push(
  candidates: readonly PushCandidate[],
  options: {
    readonly fetchImpl: FetchLike;
    readonly stateStore?: PushStateStore;
    readonly maxBytes?: number;
    readonly maxAgeMs?: number;
    readonly pushAll?: boolean;
    readonly target?: PushTarget;
    readonly now?: Date;
  },
) {
  return runSnapshotPush({
    target: options.target ?? TARGET,
    candidates,
    stateStore: options.stateStore ?? createMemoryPushStateStore(),
    maxBytes: options.maxBytes ?? DEFAULT_PUSH_MAX_BYTES,
    maxAgeMs: options.maxAgeMs ?? DEFAULT_PUSH_MAX_AGE_MS,
    pushAll: options.pushAll ?? false,
    now: options.now ?? NOW,
    fetchImpl: options.fetchImpl,
  });
}

describe('runSnapshotPush', () => {
  it('splits a request when the next file would cross the byte cap', async () => {
    const files = [candidate('a'), candidate('b'), candidate('c')];
    const first = files[0];
    const second = files[1];
    if (first === undefined || second === undefined) {
      throw new Error('fixture');
    }
    const two = estimateMultipartBodyBytes([
      { name: first.name, contents: first.contents },
      { name: second.name, contents: second.contents },
    ]);
    const three = estimateMultipartBodyBytes(
      files.map((file) => ({ name: file.name, contents: file.contents })),
    );
    expect(three).toBeGreaterThan(two);

    const recorded = recordingFetch([202, 202]);
    const report = await push(files, { fetchImpl: recorded.fetchImpl, maxBytes: two });

    expect(report.ok).toBe(true);
    expect(report.pushed).toBe(3);
    expect(recorded.calls).toEqual([['a.snapshot.json', 'b.snapshot.json'], ['c.snapshot.json']]);
  });

  it('reports a snapshot that cannot fit in one request and does not send it', async () => {
    const file = candidate('huge', '2026-11-01T00:00:00.000Z', 50_000);
    const alone = estimateMultipartBodyBytes([{ name: file.name, contents: file.contents }]);
    const recorded = recordingFetch([]);
    const report = await push([file], { fetchImpl: recorded.fetchImpl, maxBytes: alone - 1 });

    expect(recorded.calls).toEqual([]);
    expect(report.ok).toBe(false);
    expect(report.summary).toContain('Pushed 0 of 1 snapshots');
    expect(report.summary).toContain('1 failed');
    expect(report.details.join('\n')).toContain('huge.snapshot.json');
    expect(report.details.join('\n')).toContain(String(alone));
    expect(report.details.join('\n')).toContain(String(alone - 1));
    expect(report.details.join('\n')).toContain('was not sent');
  });

  it('resumes from the state file and can be forced to send accepted snapshots again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rd-push-'));
    try {
      const statePath = join(directory, '.redis-detective-push.json');
      const stateStore = createFilePushStateStore(statePath);
      const first = recordingFetch([202]);
      const initial = await push([candidate('a'), candidate('b')], {
        fetchImpl: first.fetchImpl,
        stateStore,
      });
      expect(initial.ok).toBe(true);
      expect(first.calls).toEqual([['a.snapshot.json', 'b.snapshot.json']]);

      const resumed = recordingFetch([202]);
      const second = await push([candidate('a'), candidate('b'), candidate('c')], {
        fetchImpl: resumed.fetchImpl,
        stateStore,
      });
      expect(second.ok).toBe(true);
      expect(second.skippedAlreadySent).toBe(2);
      expect(resumed.calls).toEqual([['c.snapshot.json']]);

      const stored = JSON.parse(await readFile(statePath, 'utf8')) as {
        schemaVersion: number;
        targets: { webUrl: string; instanceId: string; accepted: { snapshotId: string }[] }[];
      };
      expect(stored.schemaVersion).toBe(1);
      expect(stored.targets[0]?.webUrl).toBe('https://app.example.com');
      expect(stored.targets[0]?.accepted.map((item) => item.snapshotId)).toEqual(['a', 'b', 'c']);

      const again = recordingFetch([202]);
      const forced = await push([candidate('a'), candidate('c')], {
        fetchImpl: again.fetchImpl,
        stateStore,
        pushAll: true,
      });
      expect(forced.pushed).toBe(2);
      expect(again.calls).toEqual([['a.snapshot.json', 'c.snapshot.json']]);

      const otherHost = recordingFetch([202]);
      const elsewhere = await push([candidate('a')], {
        fetchImpl: otherHost.fetchImpl,
        stateStore,
        target: { ...TARGET, webUrl: 'https://other.example.com' },
      });
      expect(elsewhere.pushed).toBe(1);
      expect(otherHost.calls).toEqual([['a.snapshot.json']]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('names the attempted size on HTTP 413 and retries that batch on the next push', async () => {
    const files = [candidate('a'), candidate('b')];
    const stateStore = createMemoryPushStateStore();
    const attempted = estimateMultipartBodyBytes(
      files.map((file) => ({ name: file.name, contents: file.contents })),
    );
    const rejected = recordingFetch([413]);
    const failed = await push(files, { fetchImpl: rejected.fetchImpl, stateStore });

    expect(failed.ok).toBe(false);
    expect(failed.failed).toBe(2);
    expect(failed.summary).toContain('Pushed 0 of 2 snapshots');
    expect(failed.details.join('\n')).toContain('HTTP 413');
    expect(failed.details.join('\n')).toContain(String(attempted));
    expect(failed.details.join('\n')).toContain('Request Entity Too Large');
    expect((await stateStore.load()).targets).toEqual([]);

    const retried = recordingFetch([202]);
    const again = await push(files, { fetchImpl: retried.fetchImpl, stateStore });
    expect(again.ok).toBe(true);
    expect(again.pushed).toBe(2);
    expect(retried.calls).toEqual([['a.snapshot.json', 'b.snapshot.json']]);
  });

  it('keeps an accepted batch when a later batch is rejected', async () => {
    const files = [candidate('a'), candidate('b')];
    const first = files[0];
    if (first === undefined) {
      throw new Error('fixture');
    }
    const one = estimateMultipartBodyBytes([{ name: first.name, contents: first.contents }]);
    const stateStore = createMemoryPushStateStore();
    const recorded = recordingFetch([202, 413]);
    const report = await push(files, { fetchImpl: recorded.fetchImpl, stateStore, maxBytes: one });

    expect(report.ok).toBe(false);
    expect(report.pushed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.summary).toContain('Pushed 1 of 2 snapshots');
    expect(report.summary).toContain('1 failed');
    expect(recorded.calls).toEqual([['a.snapshot.json'], ['b.snapshot.json']]);
    expect((await stateStore.load()).targets[0]?.accepted.map((item) => item.snapshotId)).toEqual([
      'a',
    ]);
  });

  it('skips snapshots the hosted app would drop, and keeps one exactly at the cutoff', async () => {
    const cutoff = new Date(NOW.getTime() - DEFAULT_PUSH_MAX_AGE_MS).toISOString();
    const older = new Date(NOW.getTime() - DEFAULT_PUSH_MAX_AGE_MS - 1).toISOString();
    const recorded = recordingFetch([202]);
    const report = await push(
      [
        candidate('old', older),
        candidate('edge', cutoff),
        candidate('new', '2026-11-16T00:00:00.000Z'),
      ],
      { fetchImpl: recorded.fetchImpl },
    );

    expect(report.ok).toBe(true);
    expect(report.skippedTooOld).toBe(1);
    expect(recorded.calls).toEqual([['edge.snapshot.json', 'new.snapshot.json']]);
    expect(report.summary).toContain('older than');
  });

  it('refuses to upload when the state file cannot be read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rd-push-'));
    try {
      const statePath = join(directory, '.redis-detective-push.json');
      await writeFile(statePath, '{', 'utf8');
      const recorded = recordingFetch([]);
      const report = await push([candidate('a')], {
        fetchImpl: recorded.fetchImpl,
        stateStore: createFilePushStateStore(statePath),
      });

      expect(recorded.calls).toEqual([]);
      expect(report.ok).toBe(false);
      expect(report.summary).toContain('not valid JSON');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
