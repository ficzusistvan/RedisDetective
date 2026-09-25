export interface GitActor {
  readonly name: string;
  readonly email: string | null;
  readonly login: string | null;
}

export interface GitPullRequestRef {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** ISO-8601 UTC, or `null` for an open PR. */
  readonly mergedAt: string | null;
}

/**
 * Where a commit sits relative to the anomaly window. Only commits at or before the growth end
 * are Commit candidates; commits after `window.to` are dropped, not labelled.
 */
export type TemporalRelation = 'before-anomaly' | 'within-anomaly-window';

/**
 * A Commit candidate in the anomaly window or the Commit lookback before it. Explicitly not a
 * Cause: this package concludes nothing. Redis Causes are decided only in `packages/evidence`;
 * the reasoner may list matching SHAs as `hintedCandidateShas`, never as the Cause.
 */
export interface GitCommitCandidate {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
  readonly author: GitActor;
  /** ISO-8601 UTC. */
  readonly committedAt: string;
  readonly url: string;
  readonly pullRequest: GitPullRequestRef | null;
  readonly changedPaths: readonly string[];
  /**
   * Key patterns whose prefixes appear in the diff or commit message (e.g. `session:`).
   * A Pattern hint only — never treat a hint as proof of causation.
   */
  readonly matchedPatternHints: readonly string[];
  readonly temporalRelation: TemporalRelation;
}
