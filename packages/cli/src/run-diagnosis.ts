import { buildEvidenceGraph } from '@redis-detective/evidence';
import {
  FindCandidateCommitsError,
  GitHubApiError,
  GitHubAuthConfigError,
  GitHubAuthError,
  GitHubRateLimitError,
  findCandidateCommits,
  formatRepositoryRef,
} from '@redis-detective/github-integration';
import type { GitHubCommitSource, GitHubRepositoryRef } from '@redis-detective/github-integration';
import { explainEvidence } from '@redis-detective/reasoner';
import type { LlmClient } from '@redis-detective/reasoner';
import type { RedisCommandClient } from '@redis-detective/sampler';

import { captureSnapshot } from './capture-snapshot.js';
import {
  DEFAULT_COMMIT_LOOKBACK_HOURS,
  DEFAULT_MAX_COMMIT_CANDIDATES,
} from './commit-lookup-defaults.js';
import type { DiagnosisReport } from './diagnosis-report.js';
import { patternHintsFromGraph } from './pattern-hints-from-graph.js';
import type { SnapshotStore } from './snapshot-store.js';
import { withGitHubUnavailableGap } from './with-github-unavailable-gap.js';
import { withNoRepositoryGap } from './with-no-repository-gap.js';
import { shouldNudgeRepositoryConnection } from './should-nudge-repository-connection.js';

export interface RunDiagnosisRequest {
  readonly store: SnapshotStore;
  /** ISO-8601 UTC, supplied by the caller so the graph is reproducible in tests. */
  readonly generatedAt: string;
  /** Password-redacted URL, or `null` when diagnosing from stored snapshots only. */
  readonly target: string | null;
  /**
   * When present, this run samples live Redis, saves the snapshot, then diffs. When absent, the
   * store is read as-is — no connection is needed, which is how a snapshot directory taken on one
   * machine can be diagnosed on another.
   */
  readonly client?: RedisCommandClient;
  readonly sampleSize: number | null;
  readonly timeoutMs: number | null;
  readonly memorySamples: number | null;
  readonly databases: readonly number[] | null;
  readonly redactKeys: boolean;
  /**
   * Connected repository for candidate commits. `null` or omitted records a
   * `no-repository-connected` gap (when the Redis Cause bar is met) and leaves `commitCandidates`
   * empty — the Redis diagnosis is still produced.
   */
  readonly repository?: GitHubRepositoryRef | null;
  /**
   * When set, commit lookup is skipped and a `github-unavailable` gap is recorded. Used when the
   * operator asked for `--repo` but auth failed before a commit source existed. Prefer letting
   * `createCommitSource` fail inside this function once ≥2 snapshots exist — that is the exit-6
   * path. Pre-set detail remains for tests.
   */
  readonly githubUnavailableDetail?: string;
  /** How far before the graph window to search. Defaults to seven days. */
  readonly lookbackMs?: number;
  readonly maxCommitResults?: number;
  /**
   * Ready-made GitHub read surface. When set, used instead of `createCommitSource`. Tests pass a
   * fake; production usually passes `createCommitSource` so auth runs only after ≥2 snapshots.
   */
  readonly commitSource?: GitHubCommitSource;
  /**
   * Lazily builds the GitHub read surface. Called only when a Connected repository is set, there
   * are at least two snapshots, `commitSource` is absent, and `githubUnavailableDetail` is absent.
   */
  readonly createCommitSource?: () => Promise<GitHubCommitSource>;
  /**
   * Injected model. Omit for the deterministic paragraph. Production passes a client only when
   * `LLM_API_KEY` is set; tests omit this so they never reach a provider.
   */
  readonly llmClient?: LlmClient;
}

function hoursFromMs(lookbackMs: number): number {
  return lookbackMs / (60 * 60 * 1_000);
}

function isGitHubFailure(error: unknown): boolean {
  return (
    error instanceof GitHubAuthConfigError ||
    error instanceof GitHubAuthError ||
    error instanceof GitHubRateLimitError ||
    error instanceof GitHubApiError ||
    error instanceof FindCandidateCommitsError
  );
}

/**
 * Saves a new sample if a client was given, then diffs every stored snapshot into a diagnosis.
 *
 * The first run against an empty store is a successful diagnosis that reports
 * `insufficient-snapshots`, not a failure. Growth cannot be established from one sample, and
 * pretending otherwise is how a health check would start making causal claims. The renderer says
 * so and tells the user to run again later.
 *
 * Commit lookup and GitHub auth are deferred until there are two snapshots: there is no growth
 * window to search, and listing recent commits would look like an answer to a question that has
 * not been asked yet. Exit code 6 (GitHub unavailable) therefore only applies when candidates
 * were expected.
 *
 * When a repository was requested but GitHub cannot be reached, the Redis report is still produced
 * with a `github-unavailable` gap and empty candidates — never a hard failure that hides the Cause.
 */
export async function runDiagnosis(request: RunDiagnosisRequest): Promise<DiagnosisReport> {
  let savedLocation: string | null = null;

  if (request.client !== undefined) {
    const snapshot = await captureSnapshot({
      client: request.client,
      sampleSize: request.sampleSize,
      timeoutMs: request.timeoutMs,
      memorySamples: request.memorySamples,
      databases: request.databases,
      redactKeys: request.redactKeys,
    });
    savedLocation = await request.store.save(snapshot);
  }

  const stored = await request.store.list();
  const snapshots = stored.map((entry) => entry.snapshot);
  const graph = buildEvidenceGraph({ snapshots, builtAt: request.generatedAt });
  const repository = request.repository ?? null;
  const lookbackMs = request.lookbackMs ?? DEFAULT_COMMIT_LOOKBACK_HOURS * 60 * 60 * 1_000;
  const maxCommitResults = request.maxCommitResults ?? DEFAULT_MAX_COMMIT_CANDIDATES;
  const githubUnavailableDetail = request.githubUnavailableDetail;

  if (repository === null) {
    return finishDiagnosis(request, {
      snapshots,
      savedLocation,
      graph: shouldNudgeRepositoryConnection(graph) ? withNoRepositoryGap(graph) : graph,
      repository: null,
      lookbackHours: null,
      commitCandidates: [],
    });
  }

  const repositoryLabel = formatRepositoryRef(repository);
  const lookbackHours = hoursFromMs(lookbackMs);

  if (githubUnavailableDetail !== undefined) {
    return finishDiagnosis(request, {
      snapshots,
      savedLocation,
      graph: withGitHubUnavailableGap(graph, githubUnavailableDetail),
      repository: repositoryLabel,
      lookbackHours,
      commitCandidates: [],
    });
  }

  let commitCandidates: DiagnosisReport['commitCandidates'] = [];
  let resultGraph = graph;

  if (snapshots.length >= 2) {
    try {
      const commitSource =
        request.commitSource ??
        (request.createCommitSource === undefined ? undefined : await request.createCommitSource());
      if (commitSource === undefined) {
        throw new Error(
          'A GitHub commit source is required when a repository is connected and at least two snapshots exist.',
        );
      }
      commitCandidates = await findCandidateCommits(commitSource, {
        repository,
        anomalyWindow: graph.window,
        lookbackMs,
        patternHints: patternHintsFromGraph(graph),
        maxResults: maxCommitResults,
      });
    } catch (error) {
      if (!isGitHubFailure(error)) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : 'GitHub commit lookup failed.';
      resultGraph = withGitHubUnavailableGap(graph, detail);
      commitCandidates = [];
    }
  }

  return finishDiagnosis(request, {
    snapshots,
    savedLocation,
    graph: resultGraph,
    repository: repositoryLabel,
    lookbackHours,
    commitCandidates,
  });
}

async function finishDiagnosis(
  request: RunDiagnosisRequest,
  assembled: {
    readonly snapshots: DiagnosisReport['snapshots'];
    readonly savedLocation: string | null;
    readonly graph: DiagnosisReport['graph'];
    readonly repository: string | null;
    readonly lookbackHours: number | null;
    readonly commitCandidates: DiagnosisReport['commitCandidates'];
  },
): Promise<DiagnosisReport> {
  const explanation = await explainEvidence(
    {
      graph: assembled.graph,
      commitCandidates: assembled.commitCandidates,
      generatedAt: request.generatedAt,
    },
    request.llmClient === undefined ? {} : { llmClient: request.llmClient },
  );

  return {
    generatedAt: request.generatedAt,
    target: request.target,
    storeLocation: request.store.describe,
    savedLocation: assembled.savedLocation,
    repository: assembled.repository,
    lookbackHours: assembled.lookbackHours,
    snapshots: assembled.snapshots,
    graph: assembled.graph,
    commitCandidates: assembled.commitCandidates,
    explanation,
  };
}
