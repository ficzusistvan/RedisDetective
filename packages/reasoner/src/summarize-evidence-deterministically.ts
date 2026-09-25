import type {
  EvidenceGraph,
  EvidenceStrength,
  Explanation,
  ExplanationCitation,
  ExplanationCause,
  GitCommitCandidate,
  GrowthMechanism,
  PatternAttribution,
  TTLDriftEvent,
  TtlDriftKind,
} from '@redis-detective/core-types';

import { gapEvidenceId } from './reasoner-input.js';
import type { ReasonerInput } from './reasoner-input.js';

const STRENGTH_RANK: Record<EvidenceStrength, number> = {
  unclear: 0,
  moderate: 1,
  strong: 2,
};

const MECHANISM_SUMMARY: Record<GrowthMechanism, string> = {
  'more-keys': 'more keys of about the same size',
  'larger-values': 'the same keys holding more data',
  'keys-not-expiring': 'keys stopped expiring',
  indeterminate: 'growth the sample cannot break down further',
};

const MECHANISM_ACTION: Record<GrowthMechanism, string> = {
  'more-keys':
    'Find what creates keys under this pattern and whether anything is meant to remove them.',
  'larger-values':
    'Look for an append-only write path — a list, set or hash that grows per event and is never trimmed.',
  'keys-not-expiring':
    'Find what writes this pattern and compare it against a working version. A SET that lost its EX argument, or an EXPIRE call that is no longer reached, grows memory forever and shows up in no error log.',
  indeterminate:
    'Re-run with a larger --sample-size to separate "more keys" from "bigger values" for this pattern.',
};

const TTL_ACTION: Record<TtlDriftKind, string> = {
  'ttl-removed':
    'Highest-value finding here. Something stopped setting an expiry on this pattern; nothing will reclaim these keys until it is fixed.',
  'ttl-coverage-declining':
    'Some writers still set an expiry and others no longer do. Look for a second write path added to this pattern.',
  'ttl-lengthened':
    'A longer TTL raises the steady-state footprint. Confirm the new lifetime was intended.',
  'never-expiring-growth':
    'These keys have never had a TTL. If they are not meant to be permanent, this is where to add one.',
};

function weakestStrength(values: readonly EvidenceStrength[]): EvidenceStrength {
  if (values.length === 0) {
    return 'unclear';
  }
  return values.reduce(
    (weakest, next) => (STRENGTH_RANK[next] < STRENGTH_RANK[weakest] ? next : weakest),
    values[0] ?? 'unclear',
  );
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? '-' : bytes > 0 ? '+' : '';
  const abs = Math.abs(bytes);
  if (abs >= 1_048_576) {
    return `${sign}${(abs / 1_048_576).toFixed(1)} MiB`;
  }
  if (abs >= 1024) {
    return `${sign}${(abs / 1024).toFixed(1)} KiB`;
  }
  return `${sign}${String(abs)} bytes`;
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

function primaryAttribution(graph: EvidenceGraph): PatternAttribution | null {
  const ranked = [...graph.attributions].sort(
    (left, right) =>
      right.shareOfAnomalyGrowth - left.shareOfAnomalyGrowth ||
      left.pattern.localeCompare(right.pattern),
  );
  return ranked[0] ?? null;
}

function matchingDrift(
  graph: EvidenceGraph,
  pattern: string,
): readonly TTLDriftEvent[] {
  return graph.ttlDrift.filter((event) => event.pattern === pattern);
}

function hintedCommits(
  pattern: string,
  candidates: readonly GitCommitCandidate[],
): readonly GitCommitCandidate[] {
  const hint = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
  return candidates.filter(
    (candidate) =>
      hint !== '' &&
      candidate.matchedPatternHints.some(
        (matched) => matched === hint || matched === pattern || pattern.startsWith(matched),
      ),
  );
}

function unique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value === '' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function explanationId(graphId: string): string {
  return `explanation-${graphId}`;
}

/**
 * Produces an `Explanation` from evidence using templates only — no LLM.
 *
 * Not a degraded mode but the baseline. Phase 1 ships with no API key, so the tool has to say
 * something useful with `model: null`, and a template can only ever restate the evidence, which
 * makes this the reference for what an honest explanation looks like. If the LLM version ever says
 * something this one could not support, that is a bug in the LLM path.
 *
 * Also the fallback when an `LlmClient` is absent or `complete` fails.
 */
export function summarizeEvidenceDeterministically(input: ReasonerInput): Explanation {
  const { graph } = input;
  const attribution = primaryAttribution(graph);
  const citations: ExplanationCitation[] = [];
  const actions: string[] = [];
  const unknowns = graph.gaps.map((gap) => gap.detail);

  if (attribution === null) {
    const headline = headlineWithoutCause(graph);
    const summary = summaryWithoutCause(graph, input);
    for (const gap of graph.gaps) {
      if (gap.remedy !== null) {
        actions.push(gap.remedy);
      }
      citations.push({
        evidenceId: gapEvidenceId(gap.kind),
        kind: 'gap',
        statement: gap.detail,
      });
    }

    return {
      explanationId: explanationId(graph.graphId),
      generatedAt: input.generatedAt,
      graphId: graph.graphId,
      headline,
      summary,
      likelyCause: null,
      hintedCandidateShas: [],
      supportingEvidence: citations,
      recommendedActions: unique(actions),
      evidenceStrength: 'unclear',
      unknowns,
      model: null,
    };
  }

  const driftEvents = matchingDrift(graph, attribution.pattern);
  const anomaly = graph.anomalies.find((event) => event.eventId === attribution.anomalyId);
  const commits = hintedCommits(attribution.pattern, input.commitCandidates);

  const causeCitations: ExplanationCitation[] = [
    {
      evidenceId: attribution.attributionId,
      kind: 'attribution',
      statement: `${attribution.pattern} accounts for ${percent(attribution.shareOfAnomalyGrowth)} of the growth by ${MECHANISM_SUMMARY[attribution.mechanism]}.`,
    },
  ];
  if (anomaly !== undefined) {
    causeCitations.push({
      evidenceId: anomaly.eventId,
      kind: 'anomaly',
      statement:
        anomaly.deltaBytes === null
          ? `${anomaly.kind} on ${anomaly.metric} between ${anomaly.window.from} and ${anomaly.window.to}.`
          : `${anomaly.kind} of ${formatBytes(anomaly.deltaBytes)} on ${anomaly.metric} between ${anomaly.window.from} and ${anomaly.window.to}.`,
    });
  }
  for (const event of driftEvents) {
    causeCitations.push({
      evidenceId: event.eventId,
      kind: 'ttl-drift',
      statement: `${event.pattern} TTL coverage moved from ${percent(event.ttlCoverageBefore)} to ${percent(event.ttlCoverageAfter)} (${event.kind}).`,
    });
  }
  const commitCitations: ExplanationCitation[] = commits.map((commit) => ({
    evidenceId: commit.sha,
    kind: 'commit' as const,
    statement: `${commit.shortSha} (${commit.temporalRelation}) mentions ${commit.matchedPatternHints.join(', ') || attribution.pattern}; that is a hint, not proof.`,
  }));

  const likelyCause: ExplanationCause = {
    pattern: attribution.pattern,
    description: causeDescription(attribution, driftEvents, commits),
    citations: causeCitations,
  };

  actions.push(MECHANISM_ACTION[attribution.mechanism]);
  for (const event of driftEvents) {
    actions.push(TTL_ACTION[event.kind]);
  }
  for (const gap of graph.gaps) {
    if (gap.remedy !== null) {
      actions.push(gap.remedy);
    }
  }

  const strengths: EvidenceStrength[] = [attribution.evidenceStrength];
  if (anomaly !== undefined) {
    strengths.push(anomaly.evidenceStrength);
  }
  for (const event of driftEvents) {
    strengths.push(event.evidenceStrength);
  }

  return {
    explanationId: explanationId(graph.graphId),
    generatedAt: input.generatedAt,
    graphId: graph.graphId,
    headline: causeHeadline(attribution, driftEvents),
    summary: causeSummary(graph, attribution, anomaly?.deltaBytes ?? attribution.bytesGrowth, commits),
    likelyCause,
    hintedCandidateShas: commits.map((commit) => commit.sha),
    supportingEvidence: [...causeCitations, ...commitCitations],
    recommendedActions: unique(actions),
    evidenceStrength: weakestStrength(strengths),
    unknowns,
    model: null,
  };
}

function headlineWithoutCause(graph: EvidenceGraph): string {
  const kinds = new Set(graph.gaps.map((gap) => gap.kind));
  if (kinds.has('insufficient-snapshots')) {
    return 'Not enough snapshots to explain the growth.';
  }
  if (kinds.has('no-growth-detected')) {
    return 'No memory growth was found in this window.';
  }
  if (kinds.has('unattributed-growth')) {
    return 'Memory grew, but no pattern accounts for enough of it to name a cause.';
  }
  return 'The evidence does not support naming a cause.';
}

function summaryWithoutCause(graph: EvidenceGraph, input: ReasonerInput): string {
  const firstGap = graph.gaps[0];
  if (firstGap !== undefined) {
    return `${firstGap.detail} Window ${graph.window.from} -> ${graph.window.to}.`;
  }
  return `No anomaly, attribution or TTL drift was established from the ${String(graph.snapshotIds.length)} snapshot(s) supplied at ${input.generatedAt}.`;
}

function causeHeadline(
  attribution: PatternAttribution,
  driftEvents: readonly TTLDriftEvent[],
): string {
  const removed = driftEvents.some((event) => event.kind === 'ttl-removed');
  if (removed) {
    return `${attribution.pattern} stopped expiring and accounts for most of the memory growth.`;
  }
  return `${attribution.pattern} accounts for ${percent(attribution.shareOfAnomalyGrowth)} of the memory growth (${MECHANISM_SUMMARY[attribution.mechanism]}).`;
}

function causeDescription(
  attribution: PatternAttribution,
  driftEvents: readonly TTLDriftEvent[],
  commits: readonly GitCommitCandidate[],
): string {
  const parts = [
    `${attribution.pattern} grew by ${formatBytes(attribution.bytesGrowth)} (${percent(attribution.shareOfAnomalyGrowth)} of the anomaly) by ${MECHANISM_SUMMARY[attribution.mechanism]}.`,
  ];
  for (const event of driftEvents) {
    parts.push(
      `TTL coverage on that pattern moved from ${percent(event.ttlCoverageBefore)} to ${percent(event.ttlCoverageAfter)}.`,
    );
  }
  if (commits.length === 1) {
    const commit = commits[0];
    if (commit !== undefined) {
      parts.push(
        `Commit ${commit.shortSha} mentions this pattern in the window; that is a hint, not proof of a Redis Cause.`,
      );
    }
  } else if (commits.length > 1) {
    parts.push(
      `${String(commits.length)} commits in the window mention this pattern; that is a hint, not proof.`,
    );
  }
  return parts.join(' ');
}

function causeSummary(
  graph: EvidenceGraph,
  attribution: PatternAttribution,
  deltaBytes: number,
  commits: readonly GitCommitCandidate[],
): string {
  const parts = [
    `Between ${graph.window.from} and ${graph.window.to}, used memory moved by ${formatBytes(deltaBytes)}.`,
    `${attribution.pattern} accounts for ${percent(attribution.shareOfAnomalyGrowth)} of that growth (${MECHANISM_SUMMARY[attribution.mechanism]}).`,
  ];
  if (commits.length > 0) {
    parts.push(
      'Candidate commits that mention the pattern are listed; a matching prefix is not causation.',
    );
  }
  if (graph.gaps.length > 0) {
    parts.push('See limitations for what this sample could not establish.');
  }
  return parts.join(' ');
}
