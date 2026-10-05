import type { KeyPatternStats } from '@redis-detective/core-types';

import type { HealthCheckReport } from './health-check-report.js';
import { STRENGTH_LABEL } from './evidence-vocabulary.js';
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatEstimatedBytes,
  formatPercent,
} from './format-bytes.js';

/** Patterns listed in the table. Enough to see the shape of the key space, few enough to read. */
const MAX_LISTED_PATTERNS = 10;

function heading(text: string): string {
  return `${text}\n${'-'.repeat(text.length)}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

/**
 * `'figures'` right-aligns every column after the first, which is what makes a column of byte
 * counts comparable at a glance. `'labels'` keeps everything left-aligned, because in a
 * label/value list a long value would otherwise push all the short ones far to the right.
 */
type TableAlignment = 'figures' | 'labels';

function renderTable(
  rows: readonly (readonly string[])[],
  alignment: TableAlignment = 'figures',
): string {
  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_unused, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );

  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === 0 || alignment === 'labels'
            ? pad(cell, widths[column] ?? 0)
            : padStart(cell, widths[column] ?? 0),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function renderInstanceSection(report: HealthCheckReport): string {
  const { instance, memory } = report.snapshot;
  const rows: string[][] = [
    ['Target', report.target],
    ['Redis', `${instance.redisVersion} (${instance.mode}, ${instance.role})`],
    ['Used memory', formatBytes(memory.usedMemoryBytes)],
    [
      'RSS',
      `${formatBytes(memory.usedMemoryRssBytes)} (fragmentation ${memory.memFragmentationRatio.toFixed(2)})`,
    ],
  ];

  if (instance.maxmemoryBytes === null) {
    rows.push(['Limit', `none configured (policy ${instance.maxmemoryPolicy})`]);
  } else if (memory.usedMemoryBytes === null) {
    rows.push([
      'Limit',
      `${formatBytes(instance.maxmemoryBytes)} — used memory was not reported (policy ${instance.maxmemoryPolicy})`,
    ]);
  } else {
    const share = memory.usedMemoryBytes / instance.maxmemoryBytes;
    rows.push([
      'Limit',
      `${formatBytes(instance.maxmemoryBytes)} — ${formatPercent(share)} used, ${formatBytes(instance.maxmemoryBytes - memory.usedMemoryBytes)} free (policy ${instance.maxmemoryPolicy})`,
    ]);
  }

  const totalKeys = report.snapshot.keyspace.reduce((sum, entry) => sum + entry.keyCount, 0);
  rows.push(['Keys', formatCount(totalKeys, false)]);
  rows.push([
    'Evicted / expired',
    `${formatCount(memory.evictedKeys, false)} / ${formatCount(memory.expiredKeys, false)}`,
  ]);

  return `${heading('Instance')}\n${renderTable(rows, 'labels')}`;
}

/**
 * Totals used for the SHARE column, falling back to key counts when no byte figure exists.
 * Sharing a denominator of zero would print every pattern as `0.0%`.
 */
interface ShareTotals {
  readonly bytes: number;
  readonly keys: number;
  readonly useBytes: boolean;
}

function shareTotals(patterns: readonly KeyPatternStats[]): ShareTotals {
  const bytes = patterns.reduce((sum, pattern) => sum + pattern.estimatedBytes, 0);
  return {
    bytes,
    keys: patterns.reduce((sum, pattern) => sum + pattern.estimatedKeyCount, 0),
    useBytes: bytes > 0 && patterns.some((pattern) => pattern.bytesMeasured),
  };
}

function patternRow(pattern: KeyPatternStats, totals: ShareTotals): readonly string[] {
  const isEstimate = pattern.estimateBasis !== 'exact';
  const coverageTotal = pattern.keysWithTtl + pattern.keysWithoutTtl;
  const coverage = coverageTotal === 0 ? null : pattern.keysWithTtl / coverageTotal;
  const share = totals.useBytes
    ? pattern.estimatedBytes / totals.bytes
    : totals.keys === 0
      ? null
      : pattern.estimatedKeyCount / totals.keys;

  return [
    pattern.pattern,
    pattern.dataType,
    // `0 B` would read as a measurement of nothing rather than an absence of measurement.
    pattern.bytesMeasured ? formatEstimatedBytes(pattern.estimatedBytes, isEstimate) : 'unknown',
    share === null ? '-' : formatPercent(share),
    formatCount(pattern.estimatedKeyCount, isEstimate),
    coverage === null ? '-' : formatPercent(coverage),
    pattern.medianTtlSeconds === null ? 'none' : formatDuration(pattern.medianTtlSeconds),
  ];
}

function renderPatternSection(report: HealthCheckReport): string {
  const { patterns } = report.snapshot;
  if (patterns.length === 0) {
    return `${heading('Key patterns')}\nNo keys were sampled, so there is nothing to attribute memory to.`;
  }

  const totals = shareTotals(patterns);
  const listed = patterns.slice(0, MAX_LISTED_PATTERNS);
  const rows: (readonly string[])[] = [
    [
      'PATTERN',
      'TYPE',
      'SIZE',
      totals.useBytes ? 'SHARE' : 'KEY SHARE',
      'KEYS',
      'TTL',
      'MEDIAN TTL',
    ],
    ...listed.map((pattern) => patternRow(pattern, totals)),
  ];

  const lines = [heading('Key patterns'), renderTable(rows)];
  if (patterns.length > listed.length) {
    lines.push(`... and ${patterns.length - listed.length} more patterns.`);
  }

  // Sampled bytes never add up to used_memory: the sample misses keys, and used_memory includes
  // overhead that is not stored data. Saying so is cheaper than being asked.
  const exhaustive = patterns.every((pattern) => pattern.estimateBasis === 'exact');
  lines.push(
    exhaustive
      ? '\nEvery key was measured, so these figures are exact.'
      : '\nSIZE and KEYS are extrapolated from the sample and will not add up to used memory.\nA pattern much smaller than the sample may be missing from this table entirely.',
  );
  if (!totals.useBytes) {
    lines.push(
      'Sizes are unavailable because MEMORY USAGE is blocked, so SHARE is by key count instead.',
    );
  }

  return lines.join('\n');
}

function renderFindingsSection(report: HealthCheckReport): string {
  if (report.findings.length === 0) {
    return `${heading('Findings')}\nNothing stood out. This says what is in the instance now; it cannot tell you whether memory is growing — for that, run again later and compare.`;
  }

  const blocks = report.findings.map((finding, index) => {
    const lines = [
      `${index + 1}. ${finding.title}  [${STRENGTH_LABEL[finding.evidenceStrength]}]`,
      `   ${finding.detail}`,
    ];
    if (finding.recommendedAction !== null) {
      lines.push(`   → ${finding.recommendedAction}`);
    }
    return lines.join('\n');
  });

  return `${heading('Findings')}\n${blocks.join('\n\n')}`;
}

function renderSamplingSection(report: HealthCheckReport): string {
  const { sampling } = report.snapshot;
  const rows: string[][] = [
    [
      'Strategy',
      `${sampling.strategy}, ${sampling.scanPasses} scan ${sampling.scanPasses === 1 ? 'pass' : 'passes'}`,
    ],
    [
      'Sampled',
      `${formatCount(sampling.observedSampleSize, false)} keys (${formatPercent(sampling.effectiveSampleRate)} of key space) in ${sampling.durationMs}ms`,
    ],
  ];
  if (sampling.truncated) {
    rows.push(['Truncated', 'yes — a sampling bound stopped the scan early']);
  }

  const lines = [heading('Sampling'), renderTable(rows)];
  if (report.caveats.length > 0) {
    lines.push('', ...report.caveats.map((caveat) => `! ${caveat}`));
  }

  return lines.join('\n');
}

/**
 * Renders a report for a terminal.
 *
 * This is the whole product for a first-time user, so it has to be readable in one screen and
 * plainly honest about resting on a sample. Plain ASCII with no colour and no escape codes,
 * because this output gets pasted into tickets and piped into files.
 */
export function renderTextReport(report: HealthCheckReport): string {
  return [
    'Redis Memory Health Check',
    `Generated ${report.generatedAt}`,
    '',
    renderInstanceSection(report),
    '',
    renderFindingsSection(report),
    '',
    renderPatternSection(report),
    '',
    renderSamplingSection(report),
    '',
  ].join('\n');
}
