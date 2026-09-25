/**
 * Prints an EvidenceGraph for a synthetic TTL leak, so the shape of a real diagnosis can be eyeballed
 * without running two health checks an hour apart against a live instance.
 *
 * Not a test — `packages/evidence/test` is the guarantee. This exists to read the prose.
 *
 * Usage: pnpm build && node scripts/evidence-smoke.mjs
 */
import { buildEvidenceGraph } from '../packages/evidence/dist/index.js';

const MB = 1024 * 1024;

/** `cart:items:*` loses its TTL over four hourly snapshots, and the instance grows with it. */
const snapshots = [0, 1, 2, 3].map((hour) => {
  const ttlShare = [100, 70, 30, 0][hour];
  const usedMemoryBytes = (64 + hour * 8) * MB;

  return {
    snapshotId: `snapshot-${hour + 1}`,
    capturedAt: new Date(Date.UTC(2026, 7, 25, 10 + hour)).toISOString(),
    instance: {
      redisVersion: '7.2.4',
      mode: 'standalone',
      role: 'master',
      maxmemoryBytes: 512 * MB,
      maxmemoryPolicy: 'noeviction',
      uptimeSeconds: 86_400 + hour * 3_600,
    },
    memory: {
      usedMemoryBytes,
      usedMemoryRssBytes: Math.round(usedMemoryBytes * 1.18),
      usedMemoryDatasetBytes: Math.round(usedMemoryBytes * 0.91),
      usedMemoryPeakBytes: usedMemoryBytes,
      memFragmentationRatio: 1.18,
      evictedKeys: 0,
      expiredKeys: 4_200,
    },
    keyspace: [
      {
        db: 0,
        keyCount: 40_000 + hour * 30_000,
        keysWithExpiry: 39_000,
        averageTtlMs: 3_600_000,
      },
    ],
    patterns: [
      {
        pattern: 'cart:items:*',
        dataType: 'hash',
        sampledKeyCount: 100,
        sampledBytes: (28 + hour * 8) * MB * 0.1,
        estimatedKeyCount: 8_000 + hour * 30_000,
        estimatedBytes: (28 + hour * 8) * MB,
        bytesMeasured: true,
        keysWithTtl: ttlShare,
        keysWithoutTtl: 100 - ttlShare,
        medianTtlSeconds: ttlShare === 0 ? null : 1_800,
        exampleKeys: ['cart:items:9f3a2b'],
        estimateBasis: 'sampled-extrapolation',
      },
      {
        pattern: 'session:*',
        dataType: 'string',
        sampledKeyCount: 200,
        sampledBytes: 2 * MB,
        estimatedKeyCount: 30_000,
        estimatedBytes: 20 * MB,
        bytesMeasured: true,
        keysWithTtl: 200,
        keysWithoutTtl: 0,
        medianTtlSeconds: 900,
        exampleKeys: ['session:abc123'],
        estimateBasis: 'sampled-extrapolation',
      },
    ],
    sampling: {
      strategy: 'randomized-scan',
      requestedSampleSize: 1_000,
      observedSampleSize: 1_000,
      scanPasses: 12,
      effectiveSampleRate: 1_000 / (40_000 + hour * 30_000),
      durationMs: 240,
      truncated: false,
      warnings: [],
    },
  };
});

const graph = buildEvidenceGraph({
  snapshots,
  builtAt: '2026-08-25T14:05:00.000Z',
});

console.log(`graph ${graph.graphId}`);
console.log(`window ${graph.window.from} -> ${graph.window.to}\n`);

for (const anomaly of graph.anomalies) {
  console.log(`ANOMALY  ${anomaly.kind} on ${anomaly.metric} [${anomaly.evidenceStrength}]`);
  for (const note of anomaly.observations) {
    console.log(`         - ${note}`);
  }
}

for (const attribution of graph.attributions) {
  console.log(
    `\nCAUSE    ${attribution.pattern} — ${attribution.mechanism} — ${(attribution.shareOfAnomalyGrowth * 100).toFixed(1)}% of growth [${attribution.evidenceStrength}]`,
  );
  for (const note of attribution.observations) {
    console.log(`         - ${note}`);
  }
}

for (const drift of graph.ttlDrift) {
  console.log(
    `\nTTL      ${drift.pattern} — ${drift.kind} — coverage ${(drift.ttlCoverageBefore * 100).toFixed(0)}% -> ${(drift.ttlCoverageAfter * 100).toFixed(0)}% [${drift.evidenceStrength}]`,
  );
  for (const note of drift.observations) {
    console.log(`         - ${note}`);
  }
}

for (const gap of graph.gaps) {
  console.log(`\nGAP      ${gap.kind}: ${gap.detail}`);
  if (gap.remedy !== null) {
    console.log(`         remedy: ${gap.remedy}`);
  }
}
