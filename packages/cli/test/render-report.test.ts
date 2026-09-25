import { describe, expect, it } from 'vitest';

import {
  JSON_REPORT_SCHEMA_VERSION,
  deriveHealthFindings,
  renderJsonReport,
  renderTextReport,
} from '@redis-detective/cli';
import type { HealthCheckReport } from '@redis-detective/cli';
import type { RedisSnapshot } from '@redis-detective/core-types';

import { patternFixture, samplingFixture, snapshotFixture } from './helpers/snapshot-builder.js';

function reportFixture(snapshot: RedisSnapshot = snapshotFixture()): HealthCheckReport {
  return {
    generatedAt: '2026-08-25T10:00:00.000Z',
    target: 'redis://redis.example.com:6379',
    snapshot,
    findings: deriveHealthFindings(snapshot),
    caveats: snapshot.sampling.warnings,
  };
}

const leakySnapshot = snapshotFixture({
  patterns: [
    patternFixture({
      pattern: 'cart:items:*',
      estimatedBytes: 80_000_000,
      keysWithTtl: 0,
      keysWithoutTtl: 500,
      medianTtlSeconds: null,
    }),
    patternFixture({ pattern: 'session:*', estimatedBytes: 20_000_000 }),
  ],
});

describe('renderTextReport', () => {
  it('renders every section', () => {
    const text = renderTextReport(reportFixture(leakySnapshot));

    for (const section of [
      'Redis Memory Health Check',
      'Instance',
      'Findings',
      'Key patterns',
      'Sampling',
    ]) {
      expect(text).toContain(section);
    }
  });

  it('uses plain ASCII with no escape codes, so it can be pasted into a ticket', () => {
    const text = renderTextReport(reportFixture(leakySnapshot));

    // eslint-disable-next-line no-control-regex -- asserting the absence of control characters
    expect(text).not.toMatch(/\u001B\[/);
  });

  it('shows the redacted target rather than a raw URL', () => {
    const text = renderTextReport(reportFixture());

    expect(text).toContain('redis://redis.example.com:6379');
  });

  it('marks extrapolated figures and says they will not add up', () => {
    const text = renderTextReport(reportFixture(leakySnapshot));

    expect(text).toContain('est.');
    expect(text).toContain('will not add up to used memory');
  });

  it('says the figures are exact when the whole key space was measured', () => {
    const text = renderTextReport(
      reportFixture(snapshotFixture({ patterns: [patternFixture({ estimateBasis: 'exact' })] })),
    );

    expect(text).toContain('these figures are exact');
    expect(text).not.toContain('est.');
  });

  it('labels each finding with a qualitative band and never a score', () => {
    const text = renderTextReport(reportFixture(leakySnapshot));

    expect(text).toMatch(/\[(strong|moderate|unclear) evidence\]/);
    expect(text).not.toMatch(/confidence[:\s]*\d/i);
  });

  // A clean bill of health must not be read as "memory is not growing".
  it('says what a single snapshot cannot tell you when nothing is found', () => {
    const text = renderTextReport(reportFixture());

    expect(text).toContain('Nothing stood out');
    expect(text).toContain('cannot tell you whether memory is growing');
  });

  it('reports no configured limit rather than implying one', () => {
    const base = snapshotFixture();
    const text = renderTextReport(
      reportFixture(snapshotFixture({ instance: { ...base.instance, maxmemoryBytes: null } })),
    );

    expect(text).toContain('none configured');
  });

  it('handles an instance with no sampled keys', () => {
    const text = renderTextReport(
      reportFixture(
        snapshotFixture({
          sampling: samplingFixture({ observedSampleSize: 0, effectiveSampleRate: 0 }),
        }),
      ),
    );

    expect(text).toContain('nothing to attribute memory to');
  });

  it('surfaces sampling caveats', () => {
    const text = renderTextReport(
      reportFixture(
        snapshotFixture({
          sampling: samplingFixture({
            truncated: true,
            warnings: ['MEMORY USAGE is unavailable on this instance.'],
          }),
        }),
      ),
    );

    expect(text).toContain('MEMORY USAGE is unavailable');
    expect(text).toContain('stopped the scan early');
  });

  it('caps the pattern table and says how many were left out', () => {
    const patterns = Array.from({ length: 14 }, (_unused, index) =>
      patternFixture({ pattern: `p${index}:*`, estimatedBytes: 1_000 * (14 - index) }),
    );
    const text = renderTextReport(reportFixture(snapshotFixture({ patterns })));

    expect(text).toContain('and 4 more patterns');
  });

  it('shows an unmeasurable size as unknown rather than as zero', () => {
    const text = renderTextReport(
      reportFixture(
        snapshotFixture({
          patterns: [patternFixture({ sampledBytes: 0, estimatedBytes: 0, bytesMeasured: false })],
        }),
      ),
    );

    expect(text).toContain('unknown');
    expect(text).not.toContain('0 B');
    expect(text).toContain('MEMORY USAGE is blocked');
    expect(text).toContain('KEY SHARE');
  });

  it('says "1 scan pass" rather than "1 scan passes"', () => {
    const text = renderTextReport(
      reportFixture(snapshotFixture({ sampling: samplingFixture({ scanPasses: 1 }) })),
    );

    expect(text).toContain('1 scan pass');
    expect(text).not.toContain('1 scan passes');
  });

  it('is deterministic', () => {
    expect(renderTextReport(reportFixture(leakySnapshot))).toBe(
      renderTextReport(reportFixture(leakySnapshot)),
    );
  });
});

describe('renderJsonReport', () => {
  it('emits valid JSON with a schema version', () => {
    const parsed: unknown = JSON.parse(renderJsonReport(reportFixture(leakySnapshot)));

    expect(parsed).toMatchObject({
      schemaVersion: JSON_REPORT_SCHEMA_VERSION,
      generatedAt: '2026-08-25T10:00:00.000Z',
      target: 'redis://redis.example.com:6379',
    });
  });

  it('preserves the raw numbers rather than formatted strings', () => {
    const parsed = JSON.parse(renderJsonReport(reportFixture(leakySnapshot))) as {
      snapshot: { memory: { usedMemoryBytes: number }; patterns: { estimatedBytes: number }[] };
    };

    expect(parsed.snapshot.memory.usedMemoryBytes).toBe(104_857_600);
    expect(parsed.snapshot.patterns[0]?.estimatedBytes).toBe(80_000_000);
  });

  it('keeps the sampling metadata, so a consumer can see how thin the sample was', () => {
    const parsed = JSON.parse(renderJsonReport(reportFixture(leakySnapshot))) as {
      snapshot: {
        patterns: { estimateBasis: string }[];
        sampling: { effectiveSampleRate: number };
      };
    };

    expect(parsed.snapshot.sampling.effectiveSampleRate).toBe(0.01);
    expect(parsed.snapshot.patterns[0]?.estimateBasis).toBe('sampled-extrapolation');
  });

  it('reports evidence strength as a band, never a number', () => {
    const parsed = JSON.parse(renderJsonReport(reportFixture(leakySnapshot))) as {
      findings: { evidenceStrength: unknown }[];
    };

    for (const finding of parsed.findings) {
      expect(['strong', 'moderate', 'unclear']).toContain(finding.evidenceStrength);
    }
  });

  // Key order is fixed so two runs over the same data diff cleanly.
  it('is byte-for-byte stable across runs', () => {
    expect(renderJsonReport(reportFixture(leakySnapshot))).toBe(
      renderJsonReport(reportFixture(leakySnapshot)),
    );
  });

  it('ends with a newline', () => {
    expect(renderJsonReport(reportFixture())).toMatch(/}\n$/);
  });
});
