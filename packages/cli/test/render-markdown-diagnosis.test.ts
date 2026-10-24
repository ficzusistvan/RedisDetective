import { describe, expect, it } from 'vitest';

import {
  createMemorySnapshotStore,
  emptyCiGateThresholds,
  evaluateCiGate,
  renderMarkdownDiagnosis,
  renderMarkdownReport,
  runDiagnosis,
  runHealthCheck,
} from '@redis-detective/cli';
import { FakeRedisCommandClient, fakeKeys } from '@redis-detective/sampler/testing';

import { leakingSnapshots } from './helpers/leaking-snapshots.js';
import { snapshotFixture } from './helpers/snapshot-builder.js';

describe('renderMarkdownDiagnosis', () => {
  it('names the drifting pattern and the gate outcome for a leak series', async () => {
    const report = await runDiagnosis({
      store: createMemorySnapshotStore(leakingSnapshots()),
      generatedAt: '2026-08-25T14:00:00.000Z',
      target: 'redis://user:sup3rs3cret@redis.example.com:6379',
      sampleSize: null,
      timeoutMs: null,
      memorySamples: null,
      databases: null,
      redactKeys: false,
    });
    const gate = evaluateCiGate({
      snapshots: report.snapshots,
      thresholds: { ...emptyCiGateThresholds(), ttlDropPoints: 20 },
      warnOnly: false,
    });
    const markdown = renderMarkdownDiagnosis(report, gate);

    expect(markdown).toContain('# Redis Memory Diagnosis');
    expect(markdown).toContain('## Why');
    expect(markdown).toContain('cart:items:*');
    expect(markdown).toContain('## Gate');
    expect(markdown).toContain('**Outcome:** fail');
    expect(markdown).toContain('TTL coverage drop');
    expect(markdown).toContain('100.0% → 0.0%');
    expect(markdown).toContain('## TTL drift');
    expect(markdown).toContain('est.');
    expect(markdown).not.toContain('sup3rs3cret');
    expect(markdown).toContain('redis://user:***@redis.example.com:6379');
    expect(markdown).not.toContain('session:aaa111');
    expect(markdown).not.toMatch(/cart:items:[0-9a-f]{4}/);
  });

  it('says so when one snapshot is not enough', async () => {
    const report = await runDiagnosis({
      store: createMemorySnapshotStore([snapshotFixture()]),
      generatedAt: '2026-08-25T14:00:00.000Z',
      target: null,
      sampleSize: null,
      timeoutMs: null,
      memorySamples: null,
      databases: null,
      redactKeys: false,
    });
    const gate = evaluateCiGate({
      snapshots: report.snapshots,
      thresholds: { ...emptyCiGateThresholds(), ttlDropPoints: 20 },
      warnOnly: false,
    });
    const markdown = renderMarkdownDiagnosis(report, gate);

    expect(markdown).toContain('Not enough snapshots');
    expect(markdown).toContain('skipped (not enough snapshots to compare)');
    expect(markdown).toContain('**Named cause:** none');
  });
});

describe('renderMarkdownReport', () => {
  it('renders a health check without example keys', async () => {
    const report = await runHealthCheck({
      client: new FakeRedisCommandClient({
        databases: {
          0: {
            ...fakeKeys('cart:items:', 80, { bytes: 8_192 }),
            ...fakeKeys('session:', 40, { bytes: 128, ttlMs: 3_600_000 }),
          },
        },
      }),
      target: 'redis://user:***@localhost:6379',
      sampleSize: null,
      timeoutMs: null,
      memorySamples: null,
      databases: null,
      redactKeys: true,
      generatedAt: '2026-08-25T14:00:00.000Z',
    });

    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain('# Redis Memory Health Check');
    expect(markdown).toContain('cart:items:*');
    expect(markdown).toContain('| Pattern |');
    expect(markdown).not.toMatch(/cart:items:\d/);
    expect(markdown).not.toContain('<redacted>');
  });
});
