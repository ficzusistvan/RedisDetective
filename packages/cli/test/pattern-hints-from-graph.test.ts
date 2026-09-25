import { describe, expect, it } from 'vitest';

import { patternHintsFromGraph, runDiagnosis, createMemorySnapshotStore } from '@redis-detective/cli';

import { leakingSnapshots } from './helpers/leaking-snapshots.js';

describe('patternHintsFromGraph', () => {
  it('strips the sampling glob and keeps the Redis prefix, de-duplicated', async () => {
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

    expect(patternHintsFromGraph(report.graph)).toContain('cart:items:');
    expect(patternHintsFromGraph(report.graph).some((hint) => hint.endsWith('*'))).toBe(false);
  });
});
