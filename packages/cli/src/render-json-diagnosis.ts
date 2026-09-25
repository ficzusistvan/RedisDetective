import type { DiagnosisReport } from './diagnosis-report.js';
import { serializeSnapshot } from './serialize-snapshot.js';

/** Bump on any breaking change to the JSON shape; consumers key off this. */
export const DIAGNOSIS_REPORT_SCHEMA_VERSION = 1;

/** Distinguishes this payload from a health-check JSON report, which has no `reportType`. */
export const DIAGNOSIS_REPORT_TYPE = 'diagnosis';

/**
 * Renders a diagnosis as JSON for `--json`.
 *
 * Includes the snapshots and the full `EvidenceGraph`, so a file a user sends us is the same data
 * the tool reasoned about. Every object is rebuilt field by field rather than spread, so a new
 * internal field cannot leak into the public contract.
 */
export function renderJsonDiagnosis(report: DiagnosisReport): string {
  const { graph } = report;

  return `${JSON.stringify(
    {
      schemaVersion: DIAGNOSIS_REPORT_SCHEMA_VERSION,
      reportType: DIAGNOSIS_REPORT_TYPE,
      generatedAt: report.generatedAt,
      target: report.target,
      storeLocation: report.storeLocation,
      savedLocation: report.savedLocation,
      repository: report.repository,
      lookbackHours: report.lookbackHours,
      snapshots: report.snapshots.map(serializeSnapshot),
      commitCandidates: report.commitCandidates.map((candidate) => ({
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
      })),
      explanation: {
        explanationId: report.explanation.explanationId,
        generatedAt: report.explanation.generatedAt,
        graphId: report.explanation.graphId,
        headline: report.explanation.headline,
        summary: report.explanation.summary,
        likelyCause:
          report.explanation.likelyCause === null
            ? null
            : {
                pattern: report.explanation.likelyCause.pattern,
                description: report.explanation.likelyCause.description,
                relatedCommitShas: report.explanation.likelyCause.relatedCommitShas,
                citations: report.explanation.likelyCause.citations.map((citation) => ({
                  evidenceId: citation.evidenceId,
                  kind: citation.kind,
                  statement: citation.statement,
                })),
              },
        supportingEvidence: report.explanation.supportingEvidence.map((citation) => ({
          evidenceId: citation.evidenceId,
          kind: citation.kind,
          statement: citation.statement,
        })),
        recommendedActions: report.explanation.recommendedActions,
        evidenceStrength: report.explanation.evidenceStrength,
        unknowns: report.explanation.unknowns,
        model:
          report.explanation.model === null
            ? null
            : {
                provider: report.explanation.model.provider,
                model: report.explanation.model.model,
                promptVersion: report.explanation.model.promptVersion,
              },
      },
      graph: {
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
      },
    },
    null,
    2,
  )}\n`;
}
