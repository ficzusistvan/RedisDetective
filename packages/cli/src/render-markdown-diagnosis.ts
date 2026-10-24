import type {
  AnomalyEvent,
  GitCommitCandidate,
  PatternAttribution,
  RedisSnapshot,
  TemporalRelation,
  TTLDriftEvent,
} from '@redis-detective/core-types';

import { collectSamplingWarnings } from './collect-sampling-warnings.js';
import type { DiagnosisReport } from './diagnosis-report.js';
import type { CiGateResult } from './evaluate-ci-gate.js';
import { EVIDENCE_VOCABULARY, STRENGTH_LABEL } from './evidence-vocabulary.js';
import {
  formatCiGateFindingDetail,
  formatCiGateFindingRule,
  formatCiGateOutcome,
} from './format-ci-gate-finding.js';
import { formatBytes, formatCount, formatEstimatedBytes, formatPercent } from './format-bytes.js';
import { redactRedisUrl } from './redact-redis-url.js';

const TEMPORAL_LABEL: Record<TemporalRelation, string> = {
  'before-anomaly': 'before the growth',
  'within-anomaly-window': 'during the growth',
};

/**
 * GitHub-flavoured Markdown for a diagnosis — job summaries and a sticky PR comment.
 *
 * Example keys are never printed. They routinely embed user ids, and this output is meant to be
 * pasted onto a pull request. Pattern names (`session:*`) stay: they are the unit of attribution.
 * The Redis URL is whatever the report already redacted.
 */
export function renderMarkdownDiagnosis(
  report: DiagnosisReport,
  gate: CiGateResult | null = null,
): string {
  const { graph } = report;
  const snapshotWord = report.snapshots.length === 1 ? 'snapshot' : 'snapshots';
  const sections: string[] = [
    '# Redis Memory Diagnosis',
    '',
    `- **Generated:** ${report.generatedAt}`,
    `- **Store:** ${escapeMd(report.storeLocation)}`,
    `- **Target:** ${escapeMd(displayTarget(report.target))}`,
    `- **Window:** ${graph.window.from} → ${graph.window.to} (${String(report.snapshots.length)} ${snapshotWord})`,
  ];

  if (report.repository !== null) {
    sections.push(`- **Repository:** ${escapeMd(report.repository)}`);
  }
  if (report.savedLocation !== null) {
    sections.push(`- **Saved:** ${escapeMd(report.savedLocation)}`);
  }

  if (gate !== null) {
    sections.push(`- **Gate:** ${formatCiGateOutcome(gate)}`);
  }

  sections.push('', '## Why', '', report.explanation.headline, '', report.explanation.summary);

  const cause = report.explanation.likelyCause;
  if (cause !== null) {
    sections.push(
      '',
      `**Named cause:** \`${cause.pattern}\` (${STRENGTH_LABEL[report.explanation.evidenceStrength]})`,
      '',
      cause.description,
    );
    if (report.explanation.hintedCandidateShas.length > 0) {
      sections.push(
        '',
        `Hinted candidates (not proof): ${report.explanation.hintedCandidateShas
          .map((sha) => `\`${sha.slice(0, 7)}\``)
          .join(', ')}`,
      );
    }
  } else {
    sections.push(
      '',
      `**Named cause:** none (${STRENGTH_LABEL[report.explanation.evidenceStrength]})`,
    );
  }

  if (report.commitLookupSkippedBecauseNoGrowth) {
    sections.push(
      '',
      'Commit lookup skipped: no memory growth in this window (Connected repository was set; GitHub was not contacted).',
    );
  }

  if (report.explanation.recommendedActions.length > 0) {
    sections.push('', '### What to do', '');
    for (const action of report.explanation.recommendedActions) {
      sections.push(`- ${action}`);
    }
  }

  if (gate !== null) {
    sections.push('', renderGateMarkdown(gate));
  }

  appendListSection(
    sections,
    'Causes',
    graph.attributions.map((attribution) => renderCause(attribution, graph.anomalies)),
  );
  appendListSection(
    sections,
    'What changed',
    graph.anomalies.map((anomaly) => renderAnomaly(anomaly)),
  );
  appendListSection(
    sections,
    'TTL drift',
    graph.ttlDrift.map((event) => renderTtlDrift(event)),
  );

  const candidates = renderCommitCandidates(report);
  if (candidates !== null) {
    sections.push('', candidates);
  }

  const limitationItems = [
    ...graph.gaps.map((gap) => {
      const remedy = gap.remedy === null ? '' : ` ${gap.remedy}`;
      return `**${EVIDENCE_VOCABULARY.gap[gap.kind]}.** ${gap.detail}${remedy}`;
    }),
    ...collectSamplingWarnings(report.snapshots),
  ];
  appendListSection(sections, 'Limitations', limitationItems);

  const latest = latestSnapshot(report.snapshots);
  if (latest !== undefined) {
    sections.push('', renderLatestSnapshot(latest));
  }

  sections.push(
    '',
    '_Figures derived from a bounded sample are estimates, not measurements. Strength is a qualitative band, not a confidence score._',
    '',
  );

  return `${sections.join('\n')}\n`;
}

export function renderGateMarkdown(gate: CiGateResult): string {
  const lines = ['## Gate', '', `**Outcome:** ${formatCiGateOutcome(gate)}`];

  if (gate.baselineSnapshotId !== null && gate.currentSnapshotId !== null) {
    lines.push(
      '',
      `Compared ${String(gate.comparedSnapshotCount)} ${gate.comparedSnapshotCount === 1 ? 'snapshot' : 'snapshots'} (\`${gate.baselineSnapshotId}\` → \`${gate.currentSnapshotId}\`).`,
    );
  }

  if (gate.findings.length === 0) {
    lines.push(
      '',
      gate.outcome === 'skipped'
        ? 'No comparison was made.'
        : 'No configured threshold was crossed.',
    );
  } else {
    lines.push(
      '',
      '| Pattern | Rule | Detail |',
      '| --- | --- | --- |',
      ...gate.findings.map((finding) => {
        const detail = escapeMd(formatCiGateFindingDetail(finding));
        return `| \`${finding.pattern}\` | ${formatCiGateFindingRule(finding)} | ${detail} |`;
      }),
    );
  }

  if (gate.notes.length > 0) {
    lines.push('', ...gate.notes.map((note) => `- ${escapeMd(note)}`));
  }

  return lines.join('\n');
}

function renderCause(attribution: PatternAttribution, anomalies: readonly AnomalyEvent[]): string {
  const anomaly = anomalies.find((event) => event.eventId === attribution.anomalyId);
  const metric = anomaly?.metric ?? 'growth';
  const mechanism = EVIDENCE_VOCABULARY.mechanism[attribution.mechanism];
  const growthBits = [
    attribution.bytesGrowth !== 0 ? formatEstimatedBytes(attribution.bytesGrowth, true) : null,
    attribution.keyCountGrowth !== 0
      ? `${attribution.keyCountGrowth > 0 ? '+' : ''}${formatCount(attribution.keyCountGrowth, true)} keys`
      : null,
  ].filter((bit): bit is string => bit !== null);

  const lines = [
    `**\`${attribution.pattern}\`** accounts for ${formatPercent(attribution.shareOfAnomalyGrowth)} of the ${metric} growth (${STRENGTH_LABEL[attribution.evidenceStrength]})`,
    '',
    `Mechanism: ${mechanism.summary}`,
  ];
  if (growthBits.length > 0) {
    lines.push('', growthBits.join(', '));
  }
  for (const observation of attribution.observations) {
    lines.push('', `- ${observation}`);
  }
  if (mechanism.action !== null) {
    lines.push('', `→ ${mechanism.action}`);
  }
  return lines.join('\n');
}

function renderAnomaly(anomaly: AnomalyEvent): string {
  const phrase = EVIDENCE_VOCABULARY.anomaly[anomaly.kind];
  const lines = [
    `**${phrase.summary}** (${STRENGTH_LABEL[anomaly.evidenceStrength]})`,
    '',
    ...anomaly.observations.map((observation) => `- ${observation}`),
  ];
  if (phrase.action !== null) {
    lines.push('', `→ ${phrase.action}`);
  }
  return lines.join('\n');
}

function renderTtlDrift(event: TTLDriftEvent): string {
  const phrase = EVIDENCE_VOCABULARY.ttlDrift[event.kind];
  const lines = [
    `**\`${event.pattern}\`** — ${phrase.summary} (${STRENGTH_LABEL[event.evidenceStrength]})`,
    '',
    `Coverage ${formatPercent(event.ttlCoverageBefore)} → ${formatPercent(event.ttlCoverageAfter)}`,
    '',
    ...event.observations.map((observation) => `- ${observation}`),
  ];
  if (phrase.action !== null) {
    lines.push('', `→ ${phrase.action}`);
  }
  return lines.join('\n');
}

function renderCommitCandidates(report: DiagnosisReport): string | null {
  if (report.repository === null || report.commitLookupSkippedBecauseNoGrowth) {
    return null;
  }

  const lines = [
    '## Candidate commits',
    '',
    'These are commits in the growth window or the lookback before it. A matching key prefix is a Pattern hint, not proof.',
    '',
    `Repository: \`${report.repository}\``,
  ];

  if (report.commitCandidates.length === 0) {
    lines.push(
      '',
      'No commits were returned in this window. That does not mean nothing changed — the change may live in a different repository, or there were fewer than two snapshots to search against.',
    );
    return lines.join('\n');
  }

  lines.push('', ...report.commitCandidates.map((candidate) => renderCandidate(candidate)));
  return lines.join('\n');
}

function renderCandidate(candidate: GitCommitCandidate): string {
  const lines = [
    `- [\`${candidate.shortSha}\`](${candidate.url}) ${firstLine(candidate.message)} (${TEMPORAL_LABEL[candidate.temporalRelation]})`,
  ];
  const pull = candidate.pullRequest;
  if (pull !== null) {
    lines.push(`  - PR [#${String(pull.number)}](${pull.url}) ${pull.title}`);
  }
  if (candidate.matchedPatternHints.length > 0) {
    lines.push(
      `  - Hint: ${candidate.matchedPatternHints.map((hint) => `\`${hint}\``).join(', ')} (textual coincidence, not proof)`,
    );
  }
  return lines.join('\n');
}

function renderLatestSnapshot(snapshot: RedisSnapshot): string {
  const totalKeys = snapshot.keyspace.reduce((sum, entry) => sum + entry.keyCount, 0);
  const top = snapshot.patterns[0];
  const lines = [
    '## Latest snapshot',
    '',
    `- **Used memory:** ${formatBytes(snapshot.memory.usedMemoryBytes)}`,
    `- **Keys:** ${formatCount(totalKeys, false)}`,
  ];
  if (top !== undefined) {
    const size = top.bytesMeasured
      ? formatEstimatedBytes(top.estimatedBytes, top.estimateBasis !== 'exact')
      : 'size unknown';
    const ttlTotal = top.keysWithTtl + top.keysWithoutTtl;
    const ttl = ttlTotal === 0 ? 'TTL unknown' : `TTL ${formatPercent(top.keysWithTtl / ttlTotal)}`;
    lines.push(`- **Top pattern:** \`${top.pattern}\` (${size}, ${ttl})`);
  }
  lines.push(
    `- **Sample:** ${formatCount(snapshot.sampling.observedSampleSize, false)} keys (${formatPercent(snapshot.sampling.effectiveSampleRate)} of key space)`,
  );
  return lines.join('\n');
}

function latestSnapshot(snapshots: readonly RedisSnapshot[]): RedisSnapshot | undefined {
  if (snapshots.length === 0) {
    return undefined;
  }
  return [...snapshots].sort(
    (left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt),
  )[snapshots.length - 1];
}

function appendListSection(sections: string[], title: string, items: readonly string[]): void {
  if (items.length === 0) {
    return;
  }
  sections.push('', `## ${title}`, '');
  for (const [index, item] of items.entries()) {
    if (index > 0) {
      sections.push('');
    }
    sections.push(item);
  }
}

function firstLine(message: string): string {
  const line = message.split('\n')[0];
  return line === undefined || line.trim() === '' ? '(no message)' : line;
}

function displayTarget(target: string | null): string {
  if (target === null) {
    return 'stored snapshots only (no live connection)';
  }
  return /^rediss?:\/\//i.test(target) ? redactRedisUrl(target) : target;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, '\\|');
}
