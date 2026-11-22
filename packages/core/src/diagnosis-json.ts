import type {
  AnomalyEvent,
  EvidenceGap,
  EvidenceGraph,
  Explanation,
  GitCommitCandidate,
  PatternAttribution,
  RedisSnapshot,
  TTLDriftEvent,
} from '@redis-detective/core-types';

import type { DiagnosisReport } from './diagnosis-report.js';
import type { CiGateResult } from './evaluate-ci-gate.js';
import { serializeCiGate } from './serialize-ci-gate.js';
import { serializeSnapshot } from './serialize-snapshot.js';

/** Bump on any breaking change to the JSON shape; consumers key off this. */
export const DIAGNOSIS_REPORT_SCHEMA_VERSION = 1;

/** Distinguishes this payload from a health-check JSON report, which has no `reportType`. */
export const DIAGNOSIS_REPORT_TYPE = 'diagnosis';

/**
 * The `--json` diagnosis payload, as an object.
 *
 * Same fields and key order as `renderJsonDiagnosis`. `gate` is present only when the CLI
 * evaluated `--fail-on-*` thresholds; the library path never includes it.
 */
export interface DiagnosisJson {
  readonly schemaVersion: typeof DIAGNOSIS_REPORT_SCHEMA_VERSION;
  readonly reportType: typeof DIAGNOSIS_REPORT_TYPE;
  readonly generatedAt: string;
  readonly target: string | null;
  readonly storeLocation: string;
  readonly savedLocation: string | null;
  readonly repository: string | null;
  readonly lookbackHours: number | null;
  readonly commitLookupSkippedBecauseNoGrowth: boolean;
  readonly snapshots: readonly RedisSnapshot[];
  readonly commitCandidates: readonly DiagnosisJsonCommitCandidate[];
  readonly explanation: DiagnosisJsonExplanation;
  readonly graph: DiagnosisJsonGraph;
  readonly gate?: unknown;
}

export interface DiagnosisJsonCommitCandidate {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
  readonly author: {
    readonly name: string;
    readonly email: string | null;
    readonly login: string | null;
  };
  readonly committedAt: string;
  readonly url: string;
  readonly pullRequest: {
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly mergedAt: string | null;
  } | null;
  readonly changedPaths: readonly string[];
  readonly matchedPatternHints: readonly string[];
  readonly temporalRelation: GitCommitCandidate['temporalRelation'];
}

export interface DiagnosisJsonExplanation {
  readonly explanationId: string;
  readonly generatedAt: string;
  readonly graphId: string;
  readonly headline: string;
  readonly summary: string;
  readonly likelyCause: {
    readonly pattern: string;
    readonly description: string;
    readonly citations: readonly {
      readonly evidenceId: string;
      readonly kind: string;
      readonly statement: string;
    }[];
  } | null;
  readonly hintedCandidateShas: readonly string[];
  readonly supportingEvidence: readonly {
    readonly evidenceId: string;
    readonly kind: string;
    readonly statement: string;
  }[];
  readonly recommendedActions: readonly string[];
  readonly evidenceStrength: Explanation['evidenceStrength'];
  readonly unknowns: readonly string[];
  readonly model: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
  } | null;
}

export interface DiagnosisJsonGraph {
  readonly graphId: string;
  readonly builtAt: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly snapshotIds: readonly string[];
  readonly anomalies: readonly DiagnosisJsonAnomaly[];
  readonly attributions: readonly DiagnosisJsonAttribution[];
  readonly ttlDrift: readonly DiagnosisJsonTtlDrift[];
  readonly gaps: readonly {
    readonly kind: EvidenceGap['kind'];
    readonly detail: string;
    readonly remedy: string | null;
  }[];
}

export interface DiagnosisJsonAnomaly {
  readonly eventId: string;
  readonly kind: AnomalyEvent['kind'];
  readonly metric: AnomalyEvent['metric'];
  readonly window: { readonly from: string; readonly to: string };
  readonly valueBefore: number;
  readonly valueAfter: number;
  readonly deltaBytes: AnomalyEvent['deltaBytes'];
  readonly snapshotIdBefore: string;
  readonly snapshotIdAfter: string;
  readonly evidenceStrength: AnomalyEvent['evidenceStrength'];
  readonly observations: readonly string[];
}

export interface DiagnosisJsonAttribution {
  readonly attributionId: string;
  readonly anomalyId: string;
  readonly pattern: string;
  readonly mechanism: PatternAttribution['mechanism'];
  readonly bytesGrowth: number;
  readonly keyCountGrowth: number;
  readonly shareOfAnomalyGrowth: number;
  readonly evidenceStrength: PatternAttribution['evidenceStrength'];
  readonly supportingSnapshotIds: readonly string[];
  readonly observations: readonly string[];
}

export interface DiagnosisJsonTtlDrift {
  readonly eventId: string;
  readonly pattern: string;
  readonly kind: TTLDriftEvent['kind'];
  readonly window: { readonly from: string; readonly to: string };
  readonly ttlCoverageBefore: number;
  readonly ttlCoverageAfter: number;
  readonly medianTtlSecondsBefore: number | null;
  readonly medianTtlSecondsAfter: number | null;
  readonly snapshotIdBefore: string;
  readonly snapshotIdAfter: string;
  readonly evidenceStrength: TTLDriftEvent['evidenceStrength'];
  readonly observations: readonly string[];
}

export function toDiagnosisJson(
  report: DiagnosisReport,
  gate: CiGateResult | null = null,
): DiagnosisJson {
  const { graph } = report;
  const body: DiagnosisJson = {
    schemaVersion: DIAGNOSIS_REPORT_SCHEMA_VERSION,
    reportType: DIAGNOSIS_REPORT_TYPE,
    generatedAt: report.generatedAt,
    target: report.target,
    storeLocation: report.storeLocation,
    savedLocation: report.savedLocation,
    repository: report.repository,
    lookbackHours: report.lookbackHours,
    commitLookupSkippedBecauseNoGrowth: report.commitLookupSkippedBecauseNoGrowth,
    snapshots: report.snapshots.map(serializeSnapshot),
    commitCandidates: report.commitCandidates.map(toCommitCandidateJson),
    explanation: toExplanationJson(report.explanation),
    graph: toGraphJson(graph),
  };

  if (gate === null) {
    return body;
  }

  return { ...body, gate: serializeCiGate(gate) };
}

function toCommitCandidateJson(candidate: GitCommitCandidate): DiagnosisJsonCommitCandidate {
  return {
    sha: candidate.sha,
    shortSha: candidate.shortSha,
    message: candidate.message,
    author: {
      name: candidate.author.name,
      email: candidate.author.email,
      login: candidate.author.login,
    },
    committedAt: candidate.committedAt,
    url: candidate.url,
    pullRequest:
      candidate.pullRequest === null
        ? null
        : {
            number: candidate.pullRequest.number,
            title: candidate.pullRequest.title,
            url: candidate.pullRequest.url,
            mergedAt: candidate.pullRequest.mergedAt,
          },
    changedPaths: candidate.changedPaths,
    matchedPatternHints: candidate.matchedPatternHints,
    temporalRelation: candidate.temporalRelation,
  };
}

function toExplanationJson(explanation: Explanation): DiagnosisJsonExplanation {
  return {
    explanationId: explanation.explanationId,
    generatedAt: explanation.generatedAt,
    graphId: explanation.graphId,
    headline: explanation.headline,
    summary: explanation.summary,
    likelyCause:
      explanation.likelyCause === null
        ? null
        : {
            pattern: explanation.likelyCause.pattern,
            description: explanation.likelyCause.description,
            citations: explanation.likelyCause.citations.map((citation) => ({
              evidenceId: citation.evidenceId,
              kind: citation.kind,
              statement: citation.statement,
            })),
          },
    hintedCandidateShas: explanation.hintedCandidateShas,
    supportingEvidence: explanation.supportingEvidence.map((citation) => ({
      evidenceId: citation.evidenceId,
      kind: citation.kind,
      statement: citation.statement,
    })),
    recommendedActions: explanation.recommendedActions,
    evidenceStrength: explanation.evidenceStrength,
    unknowns: explanation.unknowns,
    model:
      explanation.model === null
        ? null
        : {
            provider: explanation.model.provider,
            model: explanation.model.model,
            promptVersion: explanation.model.promptVersion,
          },
  };
}

function toGraphJson(graph: EvidenceGraph): DiagnosisJsonGraph {
  return {
    graphId: graph.graphId,
    builtAt: graph.builtAt,
    window: { from: graph.window.from, to: graph.window.to },
    snapshotIds: graph.snapshotIds,
    anomalies: graph.anomalies.map((anomaly) => ({
      eventId: anomaly.eventId,
      kind: anomaly.kind,
      metric: anomaly.metric,
      window: { from: anomaly.window.from, to: anomaly.window.to },
      valueBefore: anomaly.valueBefore,
      valueAfter: anomaly.valueAfter,
      deltaBytes: anomaly.deltaBytes,
      snapshotIdBefore: anomaly.snapshotIdBefore,
      snapshotIdAfter: anomaly.snapshotIdAfter,
      evidenceStrength: anomaly.evidenceStrength,
      observations: anomaly.observations,
    })),
    attributions: graph.attributions.map((attribution) => ({
      attributionId: attribution.attributionId,
      anomalyId: attribution.anomalyId,
      pattern: attribution.pattern,
      mechanism: attribution.mechanism,
      bytesGrowth: attribution.bytesGrowth,
      keyCountGrowth: attribution.keyCountGrowth,
      shareOfAnomalyGrowth: attribution.shareOfAnomalyGrowth,
      evidenceStrength: attribution.evidenceStrength,
      supportingSnapshotIds: attribution.supportingSnapshotIds,
      observations: attribution.observations,
    })),
    ttlDrift: graph.ttlDrift.map((event) => ({
      eventId: event.eventId,
      pattern: event.pattern,
      kind: event.kind,
      window: { from: event.window.from, to: event.window.to },
      ttlCoverageBefore: event.ttlCoverageBefore,
      ttlCoverageAfter: event.ttlCoverageAfter,
      medianTtlSecondsBefore: event.medianTtlSecondsBefore,
      medianTtlSecondsAfter: event.medianTtlSecondsAfter,
      snapshotIdBefore: event.snapshotIdBefore,
      snapshotIdAfter: event.snapshotIdAfter,
      evidenceStrength: event.evidenceStrength,
      observations: event.observations,
    })),
    gaps: graph.gaps.map((gap) => ({
      kind: gap.kind,
      detail: gap.detail,
      remedy: gap.remedy,
    })),
  };
}
