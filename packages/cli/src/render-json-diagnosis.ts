import { toDiagnosisJson } from './diagnosis-json.js';
import type { DiagnosisReport } from './diagnosis-report.js';
import type { CiGateResult } from './evaluate-ci-gate.js';

export { DIAGNOSIS_REPORT_SCHEMA_VERSION, DIAGNOSIS_REPORT_TYPE } from './diagnosis-json.js';

/**
 * Renders a diagnosis as JSON for `--json`.
 *
 * Includes the snapshots and the full `EvidenceGraph`, so a file a user sends us is the same data
 * the tool reasoned about. The payload is built by `toDiagnosisJson` so the CLI string and the
 * library object cannot drift apart.
 */
export function renderJsonDiagnosis(
  report: DiagnosisReport,
  gate: CiGateResult | null = null,
): string {
  return `${JSON.stringify(toDiagnosisJson(report, gate), null, 2)}\n`;
}
