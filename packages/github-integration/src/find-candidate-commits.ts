import type { GitCommitCandidate, GitPullRequestRef, TimeWindow } from '@redis-detective/core-types';

import { classifyTemporalRelation } from './classify-temporal-relation.js';
import type { GitHubCommitSource, RawCommit, RawPullRequest } from './github-commit-source.js';
import type { GitHubRepositoryRef } from './github-repository-ref.js';
import { matchPatternHints } from './match-pattern-hints.js';

export interface FindCandidateCommitsRequest {
  readonly repository: GitHubRepositoryRef;
  /** The anomaly window from the `EvidenceGraph`, not an arbitrary date range. */
  readonly anomalyWindow: TimeWindow;
  /**
   * How far before the window to look. A deploy typically lands shortly before memory starts
   * moving, and a TTL regression can take much longer to become visible.
   */
  readonly lookbackMs: number;
  /** Key-pattern prefixes to look for in messages and diffs, e.g. `['session:', 'cart:']`. */
  readonly patternHints: readonly string[];
  readonly maxResults: number;
}

export class FindCandidateCommitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FindCandidateCommitsError';
  }
}

function searchWindow(anomalyWindow: TimeWindow, lookbackMs: number): TimeWindow {
  const fromMs = Date.parse(anomalyWindow.from) - lookbackMs;
  if (!Number.isFinite(fromMs) || Number.isNaN(Date.parse(anomalyWindow.to))) {
    throw new FindCandidateCommitsError(
      `Anomaly window is not a pair of ISO-8601 timestamps: ${anomalyWindow.from} -> ${anomalyWindow.to}.`,
    );
  }
  return { from: new Date(fromMs).toISOString(), to: anomalyWindow.to };
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Prefers a merged PR, then the lowest number, so the same commit always names the same PR.
 * An open PR is still useful (the change may not have been labelled merged in the API yet).
 */
function pickPullRequest(pulls: readonly RawPullRequest[]): GitPullRequestRef | null {
  if (pulls.length === 0) {
    return null;
  }

  const ranked = [...pulls].sort((left, right) => {
    const leftMerged = left.mergedAt === null ? 1 : 0;
    const rightMerged = right.mergedAt === null ? 1 : 0;
    return leftMerged - rightMerged || left.number - right.number;
  });
  const chosen = ranked[0];
  if (chosen === undefined) {
    return null;
  }

  return {
    number: chosen.number,
    title: chosen.title,
    url: chosen.url,
    mergedAt: chosen.mergedAt,
  };
}

function toCandidate(
  commit: RawCommit,
  pullRequest: GitPullRequestRef | null,
  request: FindCandidateCommitsRequest,
): GitCommitCandidate | null {
  const temporalRelation = classifyTemporalRelation(commit.committedAt, request.anomalyWindow);
  if (temporalRelation === null) {
    return null;
  }

  return {
    sha: commit.sha,
    shortSha: shortSha(commit.sha),
    message: commit.message,
    author: {
      name: commit.authorName,
      email: commit.authorEmail,
      login: commit.authorLogin,
    },
    committedAt: commit.committedAt,
    url: commit.url,
    pullRequest,
    changedPaths: commit.changedPaths,
    matchedPatternHints: matchPatternHints(
      request.patternHints,
      commit.message,
      commit.changedPaths,
    ),
    temporalRelation,
  };
}

/**
 * Finds commit candidates in or near an anomaly window.
 *
 * Returns **candidates**, in a defined order, and concludes nothing. Temporal proximity and a
 * matching key prefix are hints only — a refactor that merely renamed a constant will match just
 * as strongly as a change that actually altered Redis writes. Ranking a hint as a Cause here would
 * let a guess reach the user wearing the authority of evidence.
 *
 * `'after-anomaly'` commits are kept so a report can explicitly rule them out by timing. They are
 * not dropped, and they are not ranked below the others here — ranking is a conclusion.
 */
export async function findCandidateCommits(
  source: GitHubCommitSource,
  request: FindCandidateCommitsRequest,
): Promise<readonly GitCommitCandidate[]> {
  if (!Number.isFinite(request.lookbackMs) || request.lookbackMs < 0) {
    throw new FindCandidateCommitsError(
      `lookbackMs must be a non-negative finite number, received ${String(request.lookbackMs)}.`,
    );
  }
  if (!Number.isInteger(request.maxResults) || request.maxResults < 0) {
    throw new FindCandidateCommitsError(
      `maxResults must be a non-negative integer, received ${String(request.maxResults)}.`,
    );
  }
  if (request.maxResults === 0) {
    return [];
  }

  const window = searchWindow(request.anomalyWindow, request.lookbackMs);
  const commits = await source.listCommits({
    repository: request.repository,
    window,
    maxResults: request.maxResults,
  });

  const candidates: GitCommitCandidate[] = [];
  for (const commit of commits) {
    const pulls = await source.listPullRequestsForCommit(request.repository, commit.sha);
    const candidate = toCandidate(commit, pickPullRequest(pulls), request);
    if (candidate !== null) {
      candidates.push(candidate);
    }
    if (candidates.length >= request.maxResults) {
      break;
    }
  }

  return candidates.sort(
    (left, right) =>
      Date.parse(right.committedAt) - Date.parse(left.committedAt) ||
      left.sha.localeCompare(right.sha),
  );
}
