import { describe, expect, it } from 'vitest';

import { createMemorySnapshotStore, runDiagnosis } from '@redis-detective/cli';
import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';
import { GitHubApiError } from '@redis-detective/github-integration';

import { fakeGitHubCommitSource, rawCommit } from './helpers/fake-github-commit-source.js';
import { leakingSnapshots } from './helpers/leaking-snapshots.js';
import { snapshotFixture } from './helpers/snapshot-builder.js';

function request(
  store: ReturnType<typeof createMemorySnapshotStore>,
  overrides: Partial<Parameters<typeof runDiagnosis>[0]> = {},
) {
  return {
    store,
    generatedAt: '2026-08-25T14:00:00.000Z',
    target: 'redis://redis.example.com:6379',
    sampleSize: null,
    timeoutMs: null,
    memorySamples: null,
    databases: null,
    redactKeys: false,
    ...overrides,
  };
}

describe('runDiagnosis', () => {
  it('reports insufficient-snapshots for an empty store rather than failing', async () => {
    const report = await runDiagnosis(request(createMemorySnapshotStore()));

    expect(report.snapshots).toEqual([]);
    expect(report.savedLocation).toBeNull();
    expect(report.repository).toBeNull();
    expect(report.commitCandidates).toEqual([]);
    expect(report.graph.gaps.map((gap) => gap.kind)).toEqual(['insufficient-snapshots']);
  });

  it('saves a live sample, then diffs against what is already stored', async () => {
    const store = createMemorySnapshotStore();
    const client = new FakeRedisCommandClient({
      databases: { 0: fakeKeys('session:', 50, { ttlMs: 3_600_000 }) },
    });

    const first = await runDiagnosis(request(store, { client }));
    expect(first.snapshots).toHaveLength(1);
    expect(first.savedLocation).not.toBeNull();
    expect(first.graph.gaps.map((gap) => gap.kind)).toContain('insufficient-snapshots');

    const second = await runDiagnosis(request(store, { client }));
    expect(second.snapshots).toHaveLength(2);
    expect(second.graph.snapshotIds).toHaveLength(2);
  });

  it('names the leaking pattern from stored snapshots without opening Redis', async () => {
    const report = await runDiagnosis(
      request(createMemorySnapshotStore(leakingSnapshots()), { target: null }),
    );

    expect(report.target).toBeNull();
    expect(report.savedLocation).toBeNull();
    expect(report.graph.anomalies.map((anomaly) => anomaly.kind)).toContain('memory-growth');
    expect(report.graph.attributions.map((attribution) => attribution.pattern)).toContain(
      'cart:items:*',
    );
    expect(report.graph.attributions.map((attribution) => attribution.mechanism)).toContain(
      'keys-not-expiring',
    );
    expect(report.graph.ttlDrift.map((event) => event.kind)).toContain('ttl-removed');
    expect(report.graph.gaps.map((gap) => gap.kind)).toContain('no-repository-connected');
    expect(report.commitCandidates).toEqual([]);
    expect(report.explanation.likelyCause?.pattern).toBe('cart:items:*');
    expect(report.explanation.model).toBeNull();
  });

  it('redacts example keys before saving when asked', async () => {
    const store = createMemorySnapshotStore();
    const client = new FakeRedisCommandClient({
      databases: { 0: fakeKeys('user:', 80, { ttlMs: 60_000 }) },
    });

    const report = await runDiagnosis(request(store, { client, redactKeys: true }));
    const saved = report.snapshots[0];

    expect(saved?.patterns[0]?.exampleKeys).toEqual(['<redacted>']);
  });

  it('reports no-growth-detected for a flat series', async () => {
    const snapshots = [
      snapshotFixture({ snapshotId: 'a', capturedAt: '2026-08-25T10:00:00.000Z' }),
      snapshotFixture({ snapshotId: 'b', capturedAt: '2026-08-25T11:00:00.000Z' }),
    ];

    const report = await runDiagnosis(request(createMemorySnapshotStore(snapshots)));

    expect(report.graph.anomalies).toEqual([]);
    expect(report.graph.gaps.map((gap) => gap.kind)).toContain('no-growth-detected');
    expect(report.graph.gaps.map((gap) => gap.kind)).not.toContain('no-repository-connected');
  });

  it('records github-unavailable and keeps the Redis Cause when commit lookup fails', async () => {
    const source = {
      listCommits: () =>
        Promise.reject(new GitHubApiError('GitHub API request failed with HTTP 502', 502)),
      listPullRequestsForCommit: () => Promise.resolve([]),
    };

    const report = await runDiagnosis(
      request(createMemorySnapshotStore(leakingSnapshots()), {
        repository: { owner: 'acme', repo: 'checkout' },
        commitSource: source,
      }),
    );

    expect(report.repository).toBe('acme/checkout');
    expect(report.commitCandidates).toEqual([]);
    expect(report.graph.gaps.map((gap) => gap.kind)).toContain('github-unavailable');
    expect(report.graph.attributions.map((attribution) => attribution.pattern)).toContain(
      'cart:items:*',
    );
  });

  it('records github-unavailable from a pre-auth failure detail without calling GitHub', async () => {
    let listed = false;
    const source = {
      listCommits: () => {
        listed = true;
        return Promise.resolve([]);
      },
      listPullRequestsForCommit: () => Promise.resolve([]),
    };

    const report = await runDiagnosis(
      request(createMemorySnapshotStore(leakingSnapshots()), {
        repository: { owner: 'acme', repo: 'checkout' },
        commitSource: source,
        githubUnavailableDetail: 'GITHUB_APP_ID is not set.',
      }),
    );

    expect(listed).toBe(false);
    expect(report.commitCandidates).toEqual([]);
    expect(report.graph.gaps.map((gap) => gap.kind)).toContain('github-unavailable');
    expect(report.graph.gaps.find((gap) => gap.kind === 'github-unavailable')?.detail).toContain(
      'GITHUB_APP_ID',
    );
  });

  it('lists candidate commits from an injected source without claiming they caused the growth', async () => {
    const source = fakeGitHubCommitSource(
      [
        rawCommit({
          sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          committedAt: '2026-08-25T14:00:00.000Z',
          message: 'too late to have caused it',
          changedPaths: [],
        }),
        rawCommit(),
      ],
      {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [
          {
            number: 9,
            title: 'Keep EX on cart SET',
            url: 'https://github.com/acme/checkout/pull/9',
            mergedAt: '2026-08-25T09:30:00.000Z',
            mergeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        ],
      },
    );

    const report = await runDiagnosis(
      request(createMemorySnapshotStore(leakingSnapshots()), {
        repository: { owner: 'acme', repo: 'checkout' },
        commitSource: source,
      }),
    );

    expect(report.repository).toBe('acme/checkout');
    expect(report.graph.gaps.map((gap) => gap.kind)).not.toContain('no-repository-connected');
    expect(report.commitCandidates.map((candidate) => candidate.shortSha)).toEqual(['aaaaaaa']);
    expect(report.commitCandidates[0]?.temporalRelation).toBe('before-anomaly');
    expect(report.commitCandidates[0]?.matchedPatternHints).toContain('cart:items:');
    expect(report.commitCandidates[0]?.pullRequest?.number).toBe(9);
  });

  it('does not query GitHub until there are two snapshots', async () => {
    let listed = false;
    const source = {
      listCommits: () => {
        listed = true;
        return Promise.resolve([]);
      },
      listPullRequestsForCommit: () => Promise.resolve([]),
    };

    const report = await runDiagnosis(
      request(createMemorySnapshotStore([snapshotFixture()]), {
        repository: { owner: 'acme', repo: 'checkout' },
        commitSource: source,
      }),
    );

    expect(listed).toBe(false);
    expect(report.repository).toBe('acme/checkout');
    expect(report.commitCandidates).toEqual([]);
    expect(report.graph.gaps.map((gap) => gap.kind)).toContain('insufficient-snapshots');
  });
});
