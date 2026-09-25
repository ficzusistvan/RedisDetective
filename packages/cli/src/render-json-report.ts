import type { HealthCheckReport } from './health-check-report.js';
import { serializeSnapshot } from './serialize-snapshot.js';

/** Bump on any breaking change to the JSON shape; consumers key off this. */
export const JSON_REPORT_SCHEMA_VERSION = 1;

/**
 * Renders a report as JSON for `--json`.
 *
 * A versioned, stable contract: this is what people build scripts and CI checks on, and it is also
 * how snapshots get persisted between runs so `packages/evidence` has a series to diff.
 *
 * Every object is rebuilt field by field rather than spread from the source. That is deliberate:
 * it fixes the key order so two runs over the same data diff cleanly, and it means a new internal
 * field cannot leak into the public contract just by being added to a type.
 */
export function renderJsonReport(report: HealthCheckReport): string {
  const { snapshot } = report;

  return `${JSON.stringify(
    {
      schemaVersion: JSON_REPORT_SCHEMA_VERSION,
      generatedAt: report.generatedAt,
      target: report.target,
      snapshot: serializeSnapshot(snapshot),
      findings: report.findings.map((finding) => ({
        kind: finding.kind,
        title: finding.title,
        detail: finding.detail,
        // Qualitative band, never a score. See the confidence rule in the root AGENTS.md.
        evidenceStrength: finding.evidenceStrength,
        recommendedAction: finding.recommendedAction,
      })),
      caveats: report.caveats,
    },
    null,
    2,
  )}\n`;
}
