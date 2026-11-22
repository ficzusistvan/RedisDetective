import type { RedisSnapshot } from '@redis-detective/core-types';
import { buildEvidenceGraph } from '@redis-detective/evidence';
import type { EvidenceOptions } from '@redis-detective/evidence';
import { explainEvidence } from '@redis-detective/reasoner';
import type { LlmClient } from '@redis-detective/reasoner';

import type { DiagnosisJson } from './diagnosis-json.js';
import { toDiagnosisJson } from './diagnosis-json.js';
import type { DiagnosisReport } from './diagnosis-report.js';
import { shouldNudgeRepositoryConnection } from './should-nudge-repository-connection.js';
import { withNoRepositoryGap } from './with-no-repository-gap.js';

export interface DiagnoseSnapshotsInput {
  readonly snapshots: readonly RedisSnapshot[];
  /** ISO-8601 UTC; the caller passes the clock so results are reproducible. */
  readonly generatedAt: string;
  readonly storeLocation: string;
  /** Password-redacted URL, or omit/`null` when diagnosing stored snapshots only. */
  readonly target?: string | null;
  readonly evidenceOptions?: EvidenceOptions;
  /**
   * Injected model. Omit for the deterministic paragraph. Never constructed here — production
   * callers that want LLM wording pass a client they built themselves.
   */
  readonly llmClient?: LlmClient;
}

/**
 * Offline diagnosis of an already-loaded snapshot series.
 *
 * Returns the same `DiagnosisJson` as `redis-detective --snapshots <dir> --json --skip-gh` when no
 * repository is set — including the `no-repository-connected` gap when a Redis Cause is strong or
 * moderate enough to make commit candidates useful. No I/O; no GitHub; no Redis.
 */
export async function diagnoseSnapshots(input: DiagnoseSnapshotsInput): Promise<DiagnosisJson> {
  const graph = buildEvidenceGraph({
    snapshots: input.snapshots,
    builtAt: input.generatedAt,
    ...(input.evidenceOptions === undefined ? {} : { options: input.evidenceOptions }),
  });
  const withGap = shouldNudgeRepositoryConnection(graph) ? withNoRepositoryGap(graph) : graph;
  const explanation = await explainEvidence(
    {
      graph: withGap,
      commitCandidates: [],
      generatedAt: input.generatedAt,
    },
    input.llmClient === undefined ? {} : { llmClient: input.llmClient },
  );

  const report: DiagnosisReport = {
    generatedAt: input.generatedAt,
    target: input.target ?? null,
    storeLocation: input.storeLocation,
    savedLocation: null,
    repository: null,
    lookbackHours: null,
    snapshots: input.snapshots,
    graph: withGap,
    commitCandidates: [],
    commitLookupSkippedBecauseNoGrowth: false,
    explanation,
  };

  return toDiagnosisJson(report);
}
