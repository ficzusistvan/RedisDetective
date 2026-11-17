import { toHealthCheckJson } from './health-check-json.js';
import type { HealthCheckReport } from './health-check-report.js';

export { JSON_REPORT_SCHEMA_VERSION } from './health-check-json.js';

/**
 * Renders a report as JSON for `--json`.
 *
 * A versioned, stable contract: this is what people build scripts and CI checks on, and it is also
 * how snapshots get persisted between runs so `packages/evidence` has a series to diff.
 *
 * The payload is built by `toHealthCheckJson` so the CLI string and the library object cannot
 * drift apart.
 */
export function renderJsonReport(report: HealthCheckReport): string {
  return `${JSON.stringify(toHealthCheckJson(report), null, 2)}\n`;
}
