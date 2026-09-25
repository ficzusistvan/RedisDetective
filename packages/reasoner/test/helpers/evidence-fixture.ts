import type {
  AnomalyEvent,
  EvidenceGraph,
  Explanation,
  GitCommitCandidate,
  PatternAttribution,
  TTLDriftEvent,
} from '@redis-detective/core-types';
import type { ReasonerInput } from '@redis-detective/reasoner';

export function evidenceGraphFixture(overrides: Partial<EvidenceGraph> = {}): EvidenceGraph {
  return {
    graphId: 'graph-test-00000000',
    builtAt: '2026-08-25T11:05:00.000Z',
    window: { from: '2026-08-25T10:00:00.000Z', to: '2026-08-25T11:00:00.000Z' },
    snapshotIds: ['snapshot-1', 'snapshot-2'],
    anomalies: [],
    attributions: [],
    ttlDrift: [],
    gaps: [],
    ...overrides,
  };
}

export function reasonerInputFixture(overrides: Partial<ReasonerInput> = {}): ReasonerInput {
  return {
    graph: evidenceGraphFixture(),
    commitCandidates: [],
    generatedAt: '2026-08-25T11:06:00.000Z',
    ...overrides,
  };
}

export function explanationFixture(overrides: Partial<Explanation> = {}): Explanation {
  return {
    explanationId: 'explanation-test',
    generatedAt: '2026-08-25T11:06:00.000Z',
    graphId: 'graph-test-00000000',
    headline: 'Memory grew and the cause is not yet established.',
    summary: 'Scaffolding fixture.',
    likelyCause: null,
    supportingEvidence: [],
    recommendedActions: [],
    evidenceStrength: 'unclear',
    unknowns: [],
    model: null,
    ...overrides,
  };
}

const WINDOW = { from: '2026-08-25T10:00:00.000Z', to: '2026-08-25T14:00:00.000Z' };

export function leakingAnomaly(overrides: Partial<AnomalyEvent> = {}): AnomalyEvent {
  return {
    eventId: 'anomaly-memory-growth',
    kind: 'memory-growth',
    metric: 'used_memory',
    window: WINDOW,
    valueBefore: 64 * 1_048_576,
    valueAfter: 88 * 1_048_576,
    deltaBytes: 24 * 1_048_576,
    snapshotIdBefore: 'snapshot-1',
    snapshotIdAfter: 'snapshot-4',
    evidenceStrength: 'strong',
    observations: ['used_memory rose across four snapshots'],
    ...overrides,
  };
}

export function leakingAttribution(overrides: Partial<PatternAttribution> = {}): PatternAttribution {
  return {
    attributionId: 'attribution-cart-items',
    anomalyId: 'anomaly-memory-growth',
    pattern: 'cart:items:*',
    mechanism: 'keys-not-expiring',
    bytesGrowth: 24 * 1_048_576,
    keyCountGrowth: 60_000,
    shareOfAnomalyGrowth: 0.9,
    evidenceStrength: 'strong',
    supportingSnapshotIds: ['snapshot-1', 'snapshot-4'],
    observations: ['cart:items:* estimated bytes grew in lockstep with used_memory'],
    ...overrides,
  };
}

export function leakingTtlDrift(overrides: Partial<TTLDriftEvent> = {}): TTLDriftEvent {
  return {
    eventId: 'ttl-drift-cart-items',
    pattern: 'cart:items:*',
    kind: 'ttl-removed',
    window: WINDOW,
    ttlCoverageBefore: 1,
    ttlCoverageAfter: 0,
    medianTtlSecondsBefore: 3_600,
    medianTtlSecondsAfter: null,
    snapshotIdBefore: 'snapshot-1',
    snapshotIdAfter: 'snapshot-4',
    evidenceStrength: 'strong',
    observations: ['TTL coverage on cart:items:* collapsed to zero'],
    ...overrides,
  };
}

export function leakingCommit(overrides: Partial<GitCommitCandidate> = {}): GitCommitCandidate {
  return {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    shortSha: 'aaaaaaa',
    message: 'stop dropping EX on cart items',
    author: { name: 'Ada', email: 'ada@example.com', login: 'ada' },
    committedAt: '2026-08-25T09:00:00.000Z',
    url: 'https://github.com/acme/checkout/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    pullRequest: null,
    changedPaths: ['src/cart/items.ts'],
    matchedPatternHints: ['cart:items:'],
    temporalRelation: 'before-anomaly',
    ...overrides,
  };
}

export function leakingReasonerInput(
  overrides: Partial<ReasonerInput> = {},
): ReasonerInput {
  return reasonerInputFixture({
    graph: evidenceGraphFixture({
      graphId: 'graph-leak',
      window: WINDOW,
      snapshotIds: ['snapshot-1', 'snapshot-2', 'snapshot-3', 'snapshot-4'],
      anomalies: [leakingAnomaly()],
      attributions: [leakingAttribution()],
      ttlDrift: [leakingTtlDrift()],
      gaps: [],
    }),
    commitCandidates: [leakingCommit()],
    ...overrides,
  });
}

export function validLlmJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    headline: 'cart:items:* stopped expiring and accounts for most of the memory growth.',
    summary:
      'Between 2026-08-25T10:00:00.000Z and 2026-08-25T14:00:00.000Z, cart:items:* grew as keys stopped expiring.',
    likelyCause: {
      pattern: 'cart:items:*',
      description: 'TTLs disappeared on cart:items:* and that pattern accounts for most of the growth.',
      relatedCommitShas: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      citations: [
        {
          evidenceId: 'attribution-cart-items',
          kind: 'attribution',
          statement: 'cart:items:* accounts for 90% of the growth.',
        },
      ],
    },
    supportingEvidence: [
      {
        evidenceId: 'ttl-drift-cart-items',
        kind: 'ttl-drift',
        statement: 'TTL coverage on cart:items:* moved from 100% to 0%.',
      },
    ],
    recommendedActions: ['Find what writes this pattern and compare it against a working version.'],
    evidenceStrength: 'strong',
    unknowns: [],
    ...overrides,
  });
}
