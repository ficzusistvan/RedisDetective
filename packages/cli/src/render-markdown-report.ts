import type { KeyPatternStats } from '@redis-detective/core-types';

import { STRENGTH_LABEL } from './evidence-vocabulary.js';
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatEstimatedBytes,
  formatPercent,
} from './format-bytes.js';
import type { HealthCheckReport } from './health-check-report.js';
import { omitExampleKeySentence } from './omit-example-keys.js';
import { redactRedisUrl } from './redact-redis-url.js';

const MAX_LISTED_PATTERNS = 10;

/**
 * GitHub-flavoured Markdown for a single-snapshot health check.
 *
 * Example keys are omitted — this output is for a job summary or a PR comment.
 */
export function renderMarkdownReport(report: HealthCheckReport): string {
  const { instance, memory, patterns, sampling } = report.snapshot;
  const totalKeys = report.snapshot.keyspace.reduce((sum, entry) => sum + entry.keyCount, 0);

  const lines = [
    '# Redis Memory Health Check',
    '',
    `Generated ${report.generatedAt}`,
    '',
    '## Instance',
    '',
    `- **Target:** ${/^rediss?:\/\//i.test(report.target) ? redactRedisUrl(report.target) : report.target}`,
    `- **Redis:** ${instance.redisVersion} (${instance.mode}, ${instance.role})`,
    `- **Used memory:** ${formatBytes(memory.usedMemoryBytes)}`,
    `- **RSS:** ${formatBytes(memory.usedMemoryRssBytes)} (fragmentation ${memory.memFragmentationRatio.toFixed(2)})`,
  ];

  if (instance.maxmemoryBytes === null) {
    lines.push(`- **Limit:** none configured (policy ${instance.maxmemoryPolicy})`);
  } else if (memory.usedMemoryBytes === null) {
    lines.push(
      `- **Limit:** ${formatBytes(instance.maxmemoryBytes)} — used memory was not reported (policy ${instance.maxmemoryPolicy})`,
    );
  } else {
    const share = memory.usedMemoryBytes / instance.maxmemoryBytes;
    lines.push(
      `- **Limit:** ${formatBytes(instance.maxmemoryBytes)} — ${formatPercent(share)} used, ${formatBytes(instance.maxmemoryBytes - memory.usedMemoryBytes)} free (policy ${instance.maxmemoryPolicy})`,
    );
  }

  lines.push(
    `- **Keys:** ${formatCount(totalKeys, false)}`,
    `- **Evicted / expired:** ${formatCount(memory.evictedKeys, false)} / ${formatCount(memory.expiredKeys, false)}`,
    '',
    '## Findings',
    '',
  );

  if (report.findings.length === 0) {
    lines.push(
      'Nothing stood out. This says what is in the instance now; it cannot tell you whether memory is growing — for that, run again later and compare.',
    );
  } else {
    for (const finding of report.findings) {
      lines.push(
        `- **${finding.title}** (${STRENGTH_LABEL[finding.evidenceStrength]})`,
        `  - ${omitExampleKeySentence(finding.detail)}`,
      );
      if (finding.recommendedAction !== null) {
        lines.push(`  - → ${finding.recommendedAction}`);
      }
    }
  }

  lines.push('', '## Key patterns', '');

  if (patterns.length === 0) {
    lines.push('No keys were sampled, so there is nothing to attribute memory to.');
  } else {
    const totals = shareTotals(patterns);
    const listed = patterns.slice(0, MAX_LISTED_PATTERNS);
    const shareHeader = totals.useBytes ? 'Share' : 'Key share';
    lines.push(
      `| Pattern | Type | Size | ${shareHeader} | Keys | TTL | Median TTL |`,
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const pattern of listed) {
      lines.push(`| ${patternRow(pattern, totals).join(' | ')} |`);
    }
    if (patterns.length > listed.length) {
      lines.push('', `… and ${String(patterns.length - listed.length)} more patterns.`);
    }
    lines.push(
      '',
      'SIZE and KEYS are extrapolated from the sample and will not add up to used memory.',
    );
  }

  lines.push(
    '',
    '## Sampling',
    '',
    `- **Strategy:** ${sampling.strategy}, ${String(sampling.scanPasses)} scan ${sampling.scanPasses === 1 ? 'pass' : 'passes'}`,
    `- **Sampled:** ${formatCount(sampling.observedSampleSize, false)} keys (${formatPercent(sampling.effectiveSampleRate)} of key space) in ${String(sampling.durationMs)}ms`,
  );
  if (sampling.truncated) {
    lines.push('- **Truncated:** yes — a sampling bound stopped the scan early');
  }
  for (const caveat of report.caveats) {
    lines.push(`- ! ${caveat}`);
  }

  lines.push(
    '',
    '_Figures derived from a bounded sample are estimates, not measurements. Strength is a qualitative band, not a confidence score._',
    '',
  );

  return `${lines.join('\n')}\n`;
}

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
    `\`${pattern.pattern}\``,
    pattern.dataType,
    pattern.bytesMeasured ? formatEstimatedBytes(pattern.estimatedBytes, isEstimate) : 'unknown',
    share === null ? '-' : formatPercent(share),
    formatCount(pattern.estimatedKeyCount, isEstimate),
    coverage === null ? '-' : formatPercent(coverage),
    pattern.medianTtlSeconds === null ? 'none' : formatDuration(pattern.medianTtlSeconds),
  ];
}
