import type { RedisCommandClient } from '@redis-detective/sampler';

import { deriveHealthFindings } from './derive-health-findings.js';
import type { HealthCheckReport } from './health-check-report.js';
import { captureSnapshot } from './capture-snapshot.js';

export interface RunHealthCheckRequest {
  readonly client: RedisCommandClient;
  /** Already redacted; this value goes straight into the report. */
  readonly target: string;
  readonly sampleSize: number | null;
  readonly timeoutMs: number | null;
  readonly memorySamples: number | null;
  readonly databases: readonly number[] | null;
  /** Replace example key names with a placeholder, for a report that will be shared. */
  readonly redactKeys: boolean;
  /** ISO-8601 UTC, supplied by `bin.ts`, so the report is reproducible in tests. */
  readonly generatedAt: string;
}

/**
 * Samples the instance once and derives the health findings.
 *
 * Takes an already-connected client rather than a URL, so the whole health check is testable
 * against a fake `RedisCommandClient` with no Redis running.
 */
export async function runHealthCheck(request: RunHealthCheckRequest): Promise<HealthCheckReport> {
  const snapshot = await captureSnapshot(request);

  return {
    generatedAt: request.generatedAt,
    target: request.target,
    snapshot,
    findings: deriveHealthFindings(snapshot),
    caveats: snapshot.sampling.warnings,
  };
}
