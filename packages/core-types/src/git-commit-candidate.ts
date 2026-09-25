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
 * Where a commit sits relative to the anomaly window. Commits at or before the growth are
 * eligible to list as related candidates; `'after-anomaly'` entries are kept so a report can
 * rule them out by timing rather than silently dropping them. Timing never makes a commit a Cause.
 */
export type TemporalRelation = 'before-anomaly' | 'within-anomaly-window' | 'after-anomaly';

/**
 * A Commit candidate in or near the anomaly window. Explicitly not a Cause: this package ranks
 * nothing and concludes nothing. Redis Causes are decided only in `packages/evidence`; the
 * reasoner may list these SHAs as related candidates, never as the Cause.
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
   * A textual hint only — never treat a hint as proof of causation.
   */
  readonly matchedPatternHints: readonly string[];
  readonly temporalRelation: TemporalRelation;
}
