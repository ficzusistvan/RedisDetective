import type {
  AnomalyKind,
  AnomalyMetric,
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
import { ANOMALY_METRIC_PHRASE } from '@redis-detective/core-types';

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

/** Plain-language gloss for each TTL-drift kind. Never emit the kebab-case kind id in prose. */
const TTL_DRIFT_PHRASE: Record<TtlDriftKind, string> = {
  'ttl-removed': 'keys are being written without an expiry',
  'ttl-coverage-declining': 'keys are being written without an expiry',
  'ttl-lengthened': 'keys still expire, but live longer',
  'never-expiring-growth': 'a pattern that never expired is still growing',
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

/** Plain-language gloss for each anomaly kind. Never emit the kebab-case kind id in prose. */
const ANOMALY_PHRASE: Record<AnomalyKind, string> = {
  'memory-growth': 'Memory grew steadily',
  'memory-step-change': 'Memory jumped in a single interval',
  'fragmentation-growth': 'Allocator overhead grew while stored data stayed flat',
  'key-count-growth': 'Key count grew faster than memory',
  'eviction-onset': 'The instance started evicting keys',
};

/**
 * Metric wording for templates that read "on <metric>" / "(… on <metric>)".
 * Adds an article where the bare phrase would otherwise sound telegraphic.
 */
const METRIC_IN_STATEMENT: Record<AnomalyMetric, string> = {
  used_memory: ANOMALY_METRIC_PHRASE.used_memory,
  used_memory_dataset: ANOMALY_METRIC_PHRASE.used_memory_dataset,
  used_memory_rss: ANOMALY_METRIC_PHRASE.used_memory_rss,
  mem_fragmentation_ratio: `the ${ANOMALY_METRIC_PHRASE.mem_fragmentation_ratio}`,
  key_count: `the ${ANOMALY_METRIC_PHRASE.key_count}`,
  evicted_keys: ANOMALY_METRIC_PHRASE.evicted_keys,
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
  return `${sign}${formatBinaryMagnitude(Math.abs(bytes))}`;
}

function formatBinaryMagnitude(bytes: number): string {
  const abs = Math.abs(bytes);
  const gib = 1024 * 1_048_576;
  if (abs >= gib) {
    return `${trimOneDecimal(abs / gib)} GiB`;
  }
  if (abs >= 1_048_576) {
    return `${trimOneDecimal(abs / 1_048_576)} MiB`;
  }
  if (abs >= 1024) {
    return `${trimOneDecimal(abs / 1024)} KiB`;
  }
  const whole = String(Math.round(abs));
  return abs === 1 ? `${whole} byte` : `${whole} bytes`;
}

function trimOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** `2026-11-14T03:30:00.000Z` becomes `2026-11-14 03:30 UTC`. */
function formatUtcInstant(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(iso);
  const date = match?.[1];
  const hours = match?.[2];
  const minutes = match?.[3];
  const seconds = match?.[4];
  if (date === undefined || hours === undefined || minutes === undefined) {
    return iso;
  }
  const clock =
    seconds === undefined || seconds === '00'
      ? `${hours}:${minutes}`
      : `${hours}:${minutes}:${seconds}`;
  return `${date} ${clock} UTC`;
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

/**
 * One sentence for a TTL drift event, using a human phrase instead of the internal kind id.
 */
function ttlDriftStatement(event: TTLDriftEvent): string {
  const before = percent(event.ttlCoverageBefore);
  const after = percent(event.ttlCoverageAfter);
  const gloss = TTL_DRIFT_PHRASE[event.kind];
  if (event.kind === 'never-expiring-growth') {
    return `${event.pattern} never carried a TTL and is still growing (${gloss}).`;
  }
  if (event.kind === 'ttl-lengthened') {
    return `${event.pattern} TTL coverage moved from ${before} to ${after} (${gloss}).`;
  }
  return `${event.pattern} TTL coverage fell from ${before} to ${after} (${gloss}).`;
}

function anomalyStatement(
  kind: AnomalyKind,
  metric: AnomalyMetric,
  windowFrom: string,
  windowTo: string,
  deltaBytes: number | null,
): string {
  const phrase = ANOMALY_PHRASE[kind];
  const metricPhrase = METRIC_IN_STATEMENT[metric];
  const window = `between ${windowFrom} and ${windowTo}`;
  if (deltaBytes === null) {
    return `${phrase} on ${metricPhrase} ${window}.`;
  }
  return `${phrase} (${formatBytes(deltaBytes)} on ${metricPhrase}) ${window}.`;
}

function primaryAttribution(graph: EvidenceGraph): PatternAttribution | null {
  const ranked = [...graph.attributions].sort(
    (left, right) =>
      right.shareOfAnomalyGrowth - left.shareOfAnomalyGrowth ||
      left.pattern.localeCompare(right.pattern),
  );
  return ranked[0] ?? null;
}

function matchingDrift(graph: EvidenceGraph, pattern: string): readonly TTLDriftEvent[] {
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
    // TTL drift can stand alone: coverage collapse without a memory anomaly is still a finding.
    if (graph.ttlDrift.length > 0) {
      return explanationFromTtlDriftOnly(input);
    }

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
      statement: anomalyStatement(
        anomaly.kind,
        anomaly.metric,
        formatUtcInstant(anomaly.window.from),
        formatUtcInstant(anomaly.window.to),
        anomaly.deltaBytes,
      ),
    });
  }
  for (const event of driftEvents) {
    causeCitations.push({
      evidenceId: event.eventId,
      kind: 'ttl-drift',
      statement: ttlDriftStatement(event),
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
    summary: causeSummary(
      graph,
      attribution,
      anomaly?.deltaBytes ?? attribution.bytesGrowth,
      commits,
    ),
    likelyCause,
    hintedCandidateShas: commits.map((commit) => commit.sha),
    supportingEvidence: [...causeCitations, ...commitCitations],
    recommendedActions: unique(actions),
    evidenceStrength: weakestStrength(strengths),
    unknowns,
    model: null,
  };
}

/**
 * TTL drift without a memory attribution: report the coverage change, never claim "no TTL drift".
 *
 * `likelyCause` stays null — drift alone is not a named cause of memory growth — but the headline,
 * summary, citations and actions all restate the established events.
 */
function explanationFromTtlDriftOnly(input: ReasonerInput): Explanation {
  const { graph } = input;
  const ranked = [...graph.ttlDrift].sort(
    (left, right) =>
      STRENGTH_RANK[right.evidenceStrength] - STRENGTH_RANK[left.evidenceStrength] ||
      left.pattern.localeCompare(right.pattern) ||
      left.eventId.localeCompare(right.eventId),
  );
  const primary = ranked[0];
  if (primary === undefined) {
    // Defensive: caller guards on `ttlDrift.length > 0`.
    return {
      explanationId: explanationId(graph.graphId),
      generatedAt: input.generatedAt,
      graphId: graph.graphId,
      headline: 'The evidence does not support naming a cause.',
      summary: summaryWithoutCause(graph, input),
      likelyCause: null,
      hintedCandidateShas: [],
      supportingEvidence: [],
      recommendedActions: [],
      evidenceStrength: 'unclear',
      unknowns: graph.gaps.map((gap) => gap.detail),
      model: null,
    };
  }

  const citations: ExplanationCitation[] = ranked.map((event) => ({
    evidenceId: event.eventId,
    kind: 'ttl-drift' as const,
    statement: ttlDriftStatement(event),
  }));
  for (const gap of graph.gaps) {
    citations.push({
      evidenceId: gapEvidenceId(gap.kind),
      kind: 'gap',
      statement: gap.detail,
    });
  }

  const actions = unique([
    ...ranked.map((event) => TTL_ACTION[event.kind]),
    ...graph.gaps
      .map((gap) => gap.remedy)
      .filter((remedy): remedy is string => remedy !== null),
  ]);

  const windowText = `${formatUtcInstant(graph.window.from)} to ${formatUtcInstant(graph.window.to)}`;
  const driftSentences = ranked.map((event) => ttlDriftStatement(event));
  const summary = [
    ...driftSentences,
    `Across the window ${windowText}.`,
    graph.gaps.length > 0 ? 'See limitations for what this sample could not establish.' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');

  const headline =
    primary.kind === 'never-expiring-growth'
      ? `${primary.pattern} never carried a TTL and is still growing.`
      : primary.kind === 'ttl-lengthened'
        ? `${primary.pattern} TTL coverage moved from ${percent(primary.ttlCoverageBefore)} to ${percent(primary.ttlCoverageAfter)}.`
        : `${primary.pattern} TTL coverage fell from ${percent(primary.ttlCoverageBefore)} to ${percent(primary.ttlCoverageAfter)}.`;

  return {
    explanationId: explanationId(graph.graphId),
    generatedAt: input.generatedAt,
    graphId: graph.graphId,
    headline,
    summary,
    likelyCause: null,
    hintedCandidateShas: [],
    supportingEvidence: citations,
    recommendedActions: actions,
    evidenceStrength: weakestStrength(ranked.map((event) => event.evidenceStrength)),
    unknowns: graph.gaps.map((gap) => gap.detail),
    model: null,
  };
}

function headlineWithoutCause(graph: EvidenceGraph): string {
  const kinds = new Set(graph.gaps.map((gap) => gap.kind));
  if (kinds.has('insufficient-snapshots')) {
    return 'Not enough snapshots to explain the growth.';
  }
  if (kinds.has('no-growth-detected')) {
    const gap = graph.gaps.find((entry) => entry.kind === 'no-growth-detected');
    const sentence = openingSentence(gap?.detail ?? '');
    // The reserved sentence is only for a window whose stored size did not change. A change that
    // missed the anomaly rule already states itself as the first sentence of the gap.
    if (sentence.startsWith('Memory grew ') || sentence.startsWith('Memory fell ')) {
      return sentence;
    }
    return 'No memory growth was found in this window.';
  }
  if (kinds.has('snapshot-gap')) {
    const gap = graph.gaps.find((entry) => entry.kind === 'snapshot-gap');
    const sentence = openingSentence(gap?.detail ?? '');
    if (sentence.startsWith('Memory grew ') || sentence.startsWith('Memory fell ')) {
      return sentence;
    }
    return 'A gap between snapshots prevents attributing the memory change.';
  }
  if (kinds.has('memory-not-comparable')) {
    return 'Memory could not be compared as stored size for every snapshot.';
  }
  if (kinds.has('unattributed-growth')) {
    return 'Memory grew, but no pattern accounts for enough of it to name a cause.';
  }
  return 'The evidence does not support naming a cause.';
}

function openingSentence(detail: string): string {
  const trimmed = detail.trim();
  const breakAt = trimmed.indexOf('. ');
  if (breakAt === -1) {
    return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
  }
  return trimmed.slice(0, breakAt + 1);
}

function summaryWithoutCause(graph: EvidenceGraph, input: ReasonerInput): string {
  // Never claim TTL drift was absent when the graph already records it.
  if (graph.ttlDrift.length > 0) {
    const event = graph.ttlDrift[0];
    if (event !== undefined) {
      return `${ttlDriftStatement(event)} Window ${formatUtcInstant(graph.window.from)} to ${formatUtcInstant(graph.window.to)}.`;
    }
  }

  const firstGap = graph.gaps[0];
  const windowText = `${formatUtcInstant(graph.window.from)} to ${formatUtcInstant(graph.window.to)}`;
  if (firstGap !== undefined) {
    if (firstGap.detail.includes(windowText)) {
      return firstGap.detail;
    }
    return `${firstGap.detail} Window ${windowText}.`;
  }
  return `No anomaly or attribution was established from the ${String(graph.snapshotIds.length)} snapshot(s) supplied at ${formatUtcInstant(input.generatedAt)}.`;
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
    `Between ${formatUtcInstant(graph.window.from)} and ${formatUtcInstant(graph.window.to)}, used memory moved by ${formatBytes(deltaBytes)}.`,
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
