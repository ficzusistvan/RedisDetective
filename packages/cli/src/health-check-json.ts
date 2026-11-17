import type { RedisSnapshot } from '@redis-detective/core-types';

import type { HealthCheckReport, HealthFinding } from './health-check-report.js';
import { serializeSnapshot } from './serialize-snapshot.js';

/** Bump on any breaking change to the JSON shape; consumers key off this. */
export const JSON_REPORT_SCHEMA_VERSION = 1;

/**
 * The `--json` health-check payload, as an object.
 *
 * Same fields, same key order as `renderJsonReport`. The library returns this rather than a
 * string so an in-process caller does not have to parse what it just asked us to build.
 */
export interface HealthCheckJson {
  readonly schemaVersion: typeof JSON_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly target: string;
  readonly snapshot: RedisSnapshot;
  readonly findings: readonly HealthCheckJsonFinding[];
  readonly caveats: readonly string[];
}

export interface HealthCheckJsonFinding {
  readonly kind: HealthFinding['kind'];
  readonly title: string;
  readonly detail: string;
  readonly evidenceStrength: HealthFinding['evidenceStrength'];
  readonly recommendedAction: string | null;
}

export function toHealthCheckJson(report: HealthCheckReport): HealthCheckJson {
  return {
    schemaVersion: JSON_REPORT_SCHEMA_VERSION,
    generatedAt: report.generatedAt,
    target: report.target,
    snapshot: serializeSnapshot(report.snapshot),
    findings: report.findings.map((finding) => ({
      kind: finding.kind,
      title: finding.title,
      detail: finding.detail,
      // Qualitative band, never a score. See the confidence rule in the root AGENTS.md.
      evidenceStrength: finding.evidenceStrength,
      recommendedAction: finding.recommendedAction,
    })),
    caveats: report.caveats,
  };
}
