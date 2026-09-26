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
import { EVIDENCE_VOCABULARY, STRENGTH_LABEL } from './evidence-vocabulary.js';
import {
  formatBytes,
  formatCount,
  formatEstimatedBytes,
  formatPercent,
} from './format-bytes.js';

const TEMPORAL_LABEL: Record<TemporalRelation, string> = {
  'before-anomaly': 'before the growth',
  'within-anomaly-window': 'during the growth',
};

function heading(text: string): string {
  return `${text}\n${'-'.repeat(text.length)}`;
}

function strengthTag(value: keyof typeof STRENGTH_LABEL): string {
  return `[${STRENGTH_LABEL[value]}]`;
}

function actionLine(action: string | null): string | null {
  return action === null ? null : `   → ${action}`;
}

function observationLines(observations: readonly string[]): readonly string[] {
  return observations.map((observation) => `   - ${observation}`);
}

function renderHeader(report: DiagnosisReport): string {
  const { graph } = report;
  const snapshotWord = report.snapshots.length === 1 ? 'snapshot' : 'snapshots';
  const rows: string[][] = [
    ['Generated', report.generatedAt],
    ['Store', report.storeLocation],
    ['Target', report.target ?? 'stored snapshots only (no live connection)'],
    [
      'Window',
      `${graph.window.from} -> ${graph.window.to} (${report.snapshots.length} ${snapshotWord})`,
    ],
  ];
  if (report.repository !== null) {
    rows.push(['Repository', report.repository]);
  }
  if (report.savedLocation !== null) {
    rows.push(['Saved', report.savedLocation]);
  }

  const width = Math.max(...rows.map((row) => (row[0] ?? '').length));
  const lines = rows.map(([label, value]) => `${(label ?? '').padEnd(width)}  ${value ?? ''}`);
  return ['Redis Memory Diagnosis', ...lines].join('\n');
}

function renderCause(
  attribution: PatternAttribution,
  index: number,
  anomalies: readonly AnomalyEvent[],
): string {
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
    `${index + 1}. ${attribution.pattern} accounts for ${formatPercent(attribution.shareOfAnomalyGrowth)} of the ${metric} growth  ${strengthTag(attribution.evidenceStrength)}`,
    `   Mechanism: ${mechanism.summary}`,
  ];
  if (growthBits.length > 0) {
    lines.push(`   ${growthBits.join(', ')}`);
  }
  lines.push(...observationLines(attribution.observations));
  const action = actionLine(mechanism.action);
  if (action !== null) {
    lines.push(action);
  }
  return lines.join('\n');
}

function renderAnomaly(anomaly: AnomalyEvent, index: number): string {
  const phrase = EVIDENCE_VOCABULARY.anomaly[anomaly.kind];
  const lines = [
    `${index + 1}. ${phrase.summary}  ${strengthTag(anomaly.evidenceStrength)}`,
    ...observationLines(anomaly.observations),
  ];
  const action = actionLine(phrase.action);
  if (action !== null) {
    lines.push(action);
  }
  return lines.join('\n');
}

function renderTtlDrift(event: TTLDriftEvent, index: number): string {
  const phrase = EVIDENCE_VOCABULARY.ttlDrift[event.kind];
  const lines = [
    `${index + 1}. ${event.pattern} — ${phrase.summary}  ${strengthTag(event.evidenceStrength)}`,
    `   Coverage ${formatPercent(event.ttlCoverageBefore)} -> ${formatPercent(event.ttlCoverageAfter)}`,
    ...observationLines(event.observations),
  ];
  const action = actionLine(phrase.action);
  if (action !== null) {
    lines.push(action);
  }
  return lines.join('\n');
}

function renderSection(title: string, blocks: readonly string[]): string | null {
  if (blocks.length === 0) {
    return null;
  }
  return `${heading(title)}\n${blocks.join('\n\n')}`;
}

function firstLine(message: string): string {
  const line = message.split('\n')[0];
  return line === undefined || line.trim() === '' ? '(no message)' : line;
}

function formatLookback(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day lookback' : `${String(days)} day lookback`;
  }
  return hours === 1 ? '1 hour lookback' : `${String(hours)} hour lookback`;
}

function renderCandidate(candidate: GitCommitCandidate, index: number): string {
  const lines = [
    `${index + 1}. ${candidate.shortSha}  ${firstLine(candidate.message)}  [${TEMPORAL_LABEL[candidate.temporalRelation]}]`,
  ];
  const pull = candidate.pullRequest;
  if (pull !== null) {
    lines.push(`   PR #${String(pull.number)}  ${pull.title}`);
    lines.push(`   ${pull.url}`);
  }
  if (candidate.matchedPatternHints.length > 0) {
    lines.push(
      `   Hint: ${candidate.matchedPatternHints.join(', ')} (textual coincidence, not proof)`,
    );
  }
  lines.push(`   ${candidate.committedAt}  ${candidate.url}`);
  return lines.join('\n');
}

/**
 * Named "candidates" on purpose. Temporal proximity and a matching key prefix are hints; ranking
 * one as the cause here would let a guess reach the user wearing the authority of evidence.
 */
function renderCommitCandidates(report: DiagnosisReport): string | null {
  if (report.repository === null || report.commitLookupSkippedBecauseNoGrowth) {
    return null;
  }

  const lookback =
    report.lookbackHours === null ? null : formatLookback(report.lookbackHours);
  const intro = [
    heading('Candidate commits'),
    'These are commits in the growth window or the lookback before it. A matching key prefix is a Pattern hint, not proof.',
    'Listed during the growth first, then before it — timing groups for scanning, not a plausibility ranking. Open the linked commits/PRs and search those diffs for the attributed key pattern or TTL-related writes — still not proof.',
    lookback === null
      ? `Repository  ${report.repository}`
      : `Repository  ${report.repository}  (${lookback})`,
  ];

  if (report.commitCandidates.length === 0) {
    intro.push(
      'No commits were returned in this window. That does not mean nothing changed — the change may live in a different repository, or there were fewer than two snapshots to search against.',
    );
    return intro.join('\n');
  }

  return `${intro.join('\n')}\n\n${report.commitCandidates
    .map((candidate, index) => renderCandidate(candidate, index))
    .join('\n\n')}`;
}

function renderExplanation(report: DiagnosisReport): string {
  const { explanation } = report;
  const lines = [heading('Why'), explanation.headline, '', explanation.summary];
  const cause = explanation.likelyCause;
  if (cause !== null) {
    lines.push(
      '',
      `Named cause  ${cause.pattern}  ${strengthTag(explanation.evidenceStrength)}`,
      `   ${cause.description}`,
    );
    if (explanation.hintedCandidateShas.length > 0) {
      lines.push(
        `   Hinted candidates (not proof): ${explanation.hintedCandidateShas
          .map((sha) => sha.slice(0, 7))
          .join(', ')}`,
      );
    }
  } else {
    lines.push('', `Named cause  none  ${strengthTag(explanation.evidenceStrength)}`);
  }
  if (report.commitLookupSkippedBecauseNoGrowth) {
    lines.push(
      '',
      'Commit lookup skipped: no memory growth in this window (Connected repository was set; GitHub was not contacted).',
    );
  }
  if (explanation.recommendedActions.length > 0) {
    lines.push('', 'What to do');
    for (const action of explanation.recommendedActions) {
      lines.push(`   → ${action}`);
    }
  }
  if (explanation.model !== null) {
    lines.push(
      '',
      `Wording  ${explanation.model.provider}/${explanation.model.model} (prompt ${explanation.model.promptVersion})`,
    );
  }
  return lines.join('\n');
}

function ttlShare(pattern: RedisSnapshot['patterns'][number]): string {
  const total = pattern.keysWithTtl + pattern.keysWithoutTtl;
  return total === 0 ? 'TTL unknown' : `TTL ${formatPercent(pattern.keysWithTtl / total)}`;
}

function describeTopPattern(pattern: RedisSnapshot['patterns'][number]): string {
  const size = pattern.bytesMeasured
    ? formatEstimatedBytes(pattern.estimatedBytes, pattern.estimateBasis !== 'exact')
    : 'size unknown';
  return `${pattern.pattern}  (${size}, ${ttlShare(pattern)})`;
}

function latestSnapshot(snapshots: readonly RedisSnapshot[]): RedisSnapshot | undefined {
  if (snapshots.length === 0) {
    return undefined;
  }
  return [...snapshots].sort(
    (left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt),
  )[snapshots.length - 1];
}

/**
 * The sampler's own warnings, unedited, as a final block under the gaps that summarise them.
 *
 * A gap says a safety bound cut sampling short; these say *which* bound and at what value. Both
 * are rendered, because the gap is the one-line signal and the warning is the only form of it a
 * user can act on — the difference between "raise --timeout" and knowing that 90000 was already
 * reduced to 30000 before the scan began.
 */
function renderSamplingWarnings(snapshots: readonly RedisSnapshot[]): readonly string[] {
  const warnings = collectSamplingWarnings(snapshots);
  if (warnings.length === 0) {
    return [];
  }
  return [['Sampling warnings', ...warnings.map((warning) => `   ! ${warning}`)].join('\n')];
}

function renderLatestSnapshot(snapshot: RedisSnapshot | undefined): string | null {
  if (snapshot === undefined) {
    return null;
  }

  const totalKeys = snapshot.keyspace.reduce((sum, entry) => sum + entry.keyCount, 0);
  const top = snapshot.patterns[0];
  const rows = [
    `Used memory    ${formatBytes(snapshot.memory.usedMemoryBytes)}`,
    `Keys           ${formatCount(totalKeys, false)}`,
  ];
  if (top !== undefined) {
    rows.push(`Top pattern    ${describeTopPattern(top)}`);
  }
  rows.push(
    `Sample         ${formatCount(snapshot.sampling.observedSampleSize, false)} keys (${formatPercent(snapshot.sampling.effectiveSampleRate)} of key space)`,
  );

  return `${heading('Latest snapshot')}\n${rows.join('\n')}`;
}

/**
 * Renders a diagnosis for a terminal.
 *
 * Causes come first because that is the question the tool exists to answer. Gaps are never
 * omitted: an empty diagnosis without them would read as "your Redis is fine". Plain ASCII, no
 * colour, no escape codes — this output gets pasted into tickets.
 */
export function renderTextDiagnosis(report: DiagnosisReport): string {
  const { graph } = report;
  const sections = [
    renderHeader(report),
    renderExplanation(report),
    renderSection(
      'Causes',
      graph.attributions.map((attribution, index) =>
        renderCause(attribution, index, graph.anomalies),
      ),
    ),
    renderSection(
      'What changed',
      graph.anomalies.map((anomaly, index) => renderAnomaly(anomaly, index)),
    ),
    renderSection(
      'TTL drift',
      graph.ttlDrift.map((event, index) => renderTtlDrift(event, index)),
    ),
    renderCommitCandidates(report),
    renderSection('Limitations', [
      ...graph.gaps.map((gap) => {
        const lines = [EVIDENCE_VOCABULARY.gap[gap.kind], `   ${gap.detail}`];
        if (gap.remedy !== null) {
          lines.push(`   → ${gap.remedy}`);
        }
        return lines.join('\n');
      }),
      ...renderSamplingWarnings(report.snapshots),
    ]),
    renderLatestSnapshot(latestSnapshot(report.snapshots)),
  ].filter((section): section is string => section !== null);

  return `${sections.join('\n\n')}\n`;
}
