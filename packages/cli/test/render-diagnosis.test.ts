import { describe, expect, it } from 'vitest';

import {
  DIAGNOSIS_REPORT_SCHEMA_VERSION,
  DIAGNOSIS_REPORT_TYPE,
  createMemorySnapshotStore,
  renderJsonDiagnosis,
  renderTextDiagnosis,
  runDiagnosis,
} from '@redis-detective/cli';
import type { DiagnosisReport } from '@redis-detective/cli';

import { leakingSnapshots } from './helpers/leaking-snapshots.js';
import { fakeGitHubCommitSource, rawCommit } from './helpers/fake-github-commit-source.js';
import { samplingFixture, snapshotFixture } from './helpers/snapshot-builder.js';

async function diagnose(snapshots: readonly ReturnType<typeof snapshotFixture>[]): Promise<DiagnosisReport> {
  return runDiagnosis({
    store: createMemorySnapshotStore(snapshots),
    generatedAt: '2026-08-25T14:00:00.000Z',
    target: 'redis://redis.example.com:6379',
    sampleSize: null,
    timeoutMs: null,
    memorySamples: null,
    databases: null,
    redactKeys: false,
  });
}

describe('renderTextDiagnosis', () => {
  it('leads with the cause, the TTL collapse, and what to do about it', async () => {
    const text = renderTextDiagnosis(await diagnose([...leakingSnapshots()]));

    expect(text).toContain('Redis Memory Diagnosis');
    expect(text).toContain('Why');
    expect(text).toContain('cart:items:*');
    expect(text).toContain('Causes');
    expect(text).toContain('keys stopped expiring');
    expect(text).toContain('TTLs disappeared');
    expect(text).toContain('SET that lost its EX argument');
    expect(text).toContain('What changed');
    expect(text).toContain('Memory grew steadily');
    expect(text).toContain('Latest snapshot');
    expect(text).toContain('No repository connected');
    expect(text).not.toContain('Candidate commits');
  });

  it('uses plain ASCII with no escape codes', async () => {
    const text = renderTextDiagnosis(await diagnose([...leakingSnapshots()]));

    // eslint-disable-next-line no-control-regex -- asserting the absence of control characters
    expect(text).not.toMatch(/\u001B\[/);
  });

  it('says so when one snapshot is not enough, instead of inventing a cause', async () => {
    const text = renderTextDiagnosis(await diagnose([snapshotFixture()]));

    expect(text).toContain('Not enough snapshots');
    expect(text).toContain('Named cause  none');
    expect(text).not.toContain('Causes');
    expect(text).not.toContain('No repository connected');
    expect(text).toContain('Latest snapshot');
  });

  it('says so when nothing grew', async () => {
    const text = renderTextDiagnosis(
      await diagnose([
        snapshotFixture({ snapshotId: 'a', capturedAt: '2026-08-25T10:00:00.000Z' }),
        snapshotFixture({ snapshotId: 'b', capturedAt: '2026-08-25T11:00:00.000Z' }),
      ]),
    );

    expect(text).toContain('No growth found');
    expect(text).not.toContain('Causes');
    expect(text).not.toContain('No repository connected');
  });

  it('names the bound that stopped sampling, not just that one did', async () => {
    const deadline = 'Sampling stopped after 30000ms deadline.';
    const clamp =
      'Requested sampling bound was reduced: maxDurationMs reduced from 90000 to the hard limit of 30000.';
    const text = renderTextDiagnosis(
      await diagnose([
        snapshotFixture({
          snapshotId: 'a',
          capturedAt: '2026-08-25T10:00:00.000Z',
          sampling: samplingFixture({ truncated: true, warnings: [clamp, deadline] }),
        }),
        snapshotFixture({
          snapshotId: 'b',
          capturedAt: '2026-08-25T11:00:00.000Z',
          sampling: samplingFixture({ truncated: true, warnings: [clamp, deadline] }),
        }),
      ]),
    );

    // The summary line stays: it is the one-line signal that the figures rest on a partial scan.
    expect(text).toContain('cut short by a safety bound');
    expect(text).toContain(deadline);
    expect(text).toContain(clamp);
    // Both snapshots carry both warnings; each is reported once, not once per snapshot.
    expect(text.split(deadline)).toHaveLength(2);
    expect(text.split(clamp)).toHaveLength(2);
  });

  it('says nothing about sampling warnings when the sampler raised none', async () => {
    const text = renderTextDiagnosis(await diagnose([...leakingSnapshots()]));

    expect(text).not.toContain('Sampling warnings');
  });

  it('labels an offline diagnosis so it is not mistaken for a live sample', async () => {
    const report = await runDiagnosis({
      store: createMemorySnapshotStore(leakingSnapshots()),
      generatedAt: '2026-08-25T14:00:00.000Z',
      target: null,
      sampleSize: null,
      timeoutMs: null,
      memorySamples: null,
      databases: null,
      redactKeys: false,
    });

    expect(renderTextDiagnosis(report)).toContain('stored snapshots only');
  });

  it('lists candidate commits as hints and omits commits that landed after the growth', async () => {
    const report = await runDiagnosis({
      store: createMemorySnapshotStore(leakingSnapshots()),
      generatedAt: '2026-08-25T14:00:00.000Z',
      target: 'redis://redis.example.com:6379',
      sampleSize: null,
      timeoutMs: null,
      memorySamples: null,
      databases: null,
      redactKeys: false,
      repository: { owner: 'acme', repo: 'checkout' },
      commitSource: fakeGitHubCommitSource([
        rawCommit({
          sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          committedAt: '2026-08-25T14:00:00.000Z',
          message: 'docs: changelog',
          changedPaths: [],
        }),
        rawCommit(),
      ]),
    });

    const text = renderTextDiagnosis(report);

    expect(text).toContain('Candidate commits');
    expect(text).toContain('acme/checkout');
    expect(text).toContain('hint, not proof');
    expect(text).toContain('Listed during the growth first, then before');
    expect(text).toContain('search those diffs for the attributed key pattern');
    expect(text).toContain('stop dropping EX on cart items');
    expect(text).toContain('before the growth');
    expect(text).not.toContain('docs: changelog');
    expect(text).not.toContain('too late to fall in the growth window');
    expect(text).not.toContain('No repository connected');
  });

  it('notes that commit lookup was skipped when the window has no growth', async () => {
    const report = await runDiagnosis({
      store: createMemorySnapshotStore([
        snapshotFixture({ snapshotId: 'a', capturedAt: '2026-08-25T10:00:00.000Z' }),
        snapshotFixture({ snapshotId: 'b', capturedAt: '2026-08-25T11:00:00.000Z' }),
      ]),
      generatedAt: '2026-08-25T14:00:00.000Z',
      target: null,
      sampleSize: null,
      timeoutMs: null,
      memorySamples: null,
      databases: null,
      redactKeys: false,
      repository: { owner: 'acme', repo: 'checkout' },
      createCommitSource: () => Promise.resolve(fakeGitHubCommitSource([rawCommit()])),
    });

    const text = renderTextDiagnosis(report);

    expect(report.commitLookupSkippedBecauseNoGrowth).toBe(true);
    expect(text).toContain('Commit lookup skipped: no memory growth');
    expect(text).toContain('Repository');
    expect(text).toContain('acme/checkout');
    expect(text).not.toContain('Candidate commits');
    expect(text).not.toContain('GitHub unavailable');
  });
});

describe('renderJsonDiagnosis', () => {
  it('emits valid JSON tagged as a diagnosis', async () => {
    const parsed: unknown = JSON.parse(
      renderJsonDiagnosis(await diagnose([...leakingSnapshots()])),
    );

    expect(parsed).toMatchObject({
      schemaVersion: DIAGNOSIS_REPORT_SCHEMA_VERSION,
      reportType: DIAGNOSIS_REPORT_TYPE,
      generatedAt: '2026-08-25T14:00:00.000Z',
      repository: null,
      lookbackHours: null,
      commitCandidates: [],
      commitLookupSkippedBecauseNoGrowth: false,
    });
  });

  it('includes the graph a consumer would cite', async () => {
    const parsed = JSON.parse(renderJsonDiagnosis(await diagnose([...leakingSnapshots()]))) as {
      graph: {
        attributions: { pattern: string; mechanism: string; evidenceStrength: string }[];
        ttlDrift: { kind: string }[];
      };
    };

    expect(parsed.graph.attributions[0]?.pattern).toBe('cart:items:*');
    expect(parsed.graph.attributions[0]?.mechanism).toBe('keys-not-expiring');
    expect(['strong', 'moderate', 'unclear']).toContain(
      parsed.graph.attributions[0]?.evidenceStrength,
    );
    expect(parsed.graph.ttlDrift[0]?.kind).toBe('ttl-removed');
  });

  it('includes the explanation paragraph a consumer would cite', async () => {
    const parsed = JSON.parse(renderJsonDiagnosis(await diagnose([...leakingSnapshots()]))) as {
      explanation: { headline: string; likelyCause: { pattern: string } | null; model: null };
    };

    expect(parsed.explanation.headline).toContain('cart:items:*');
    expect(parsed.explanation.likelyCause?.pattern).toBe('cart:items:*');
    expect(parsed.explanation.model).toBeNull();
  });

  it('is byte-for-byte stable across runs', async () => {
    const report = await diagnose([...leakingSnapshots()]);
    expect(renderJsonDiagnosis(report)).toBe(renderJsonDiagnosis(report));
  });

  it('includes commit candidates when a repository was searched', async () => {
    const report = await runDiagnosis({
      store: createMemorySnapshotStore(leakingSnapshots()),
      generatedAt: '2026-08-25T14:00:00.000Z',
      target: 'redis://redis.example.com:6379',
      sampleSize: null,
      timeoutMs: null,
      memorySamples: null,
      databases: null,
      redactKeys: false,
      repository: { owner: 'acme', repo: 'checkout' },
      commitSource: fakeGitHubCommitSource([rawCommit()]),
    });

    const parsed = JSON.parse(renderJsonDiagnosis(report)) as {
      repository: string;
      commitCandidates: { shortSha: string; temporalRelation: string }[];
    };

    expect(parsed.repository).toBe('acme/checkout');
    expect(parsed.commitCandidates[0]?.shortSha).toBe('aaaaaaa');
    expect(parsed.commitCandidates[0]?.temporalRelation).toBe('before-anomaly');
  });

  it('ends with a newline', async () => {
    expect(renderJsonDiagnosis(await diagnose([snapshotFixture()]))).toMatch(/}\n$/);
  });
});
