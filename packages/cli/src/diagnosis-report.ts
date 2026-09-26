import type { EvidenceGraph, Explanation, GitCommitCandidate, RedisSnapshot } from '@redis-detective/core-types';

/**
 * The multi-snapshot output: what a series of snapshots can support that one cannot.
 *
 * Separate from `HealthCheckReport` for the same reason that report is separate from an
 * `Explanation`. A health check says what is *in* the instance; this says what *changed* and which
 * Redis Cause the evidence supports. Collapsing the two would let the single-snapshot path inherit
 * causal language it has no evidence for.
 *
 * The `graph` is the Redis half of the analysis. Commit candidates live next to it, not inside it:
 * they come from GitHub, not from snapshots, and they are candidates rather than causes. Everything
 * the renderer prints is read from this object, so `--json` output and text output cannot disagree.
 */
export interface DiagnosisReport {
  readonly generatedAt: string;
  /**
   * The instance this run sampled, password-redacted. `null` when the diagnosis was produced purely
   * from stored snapshots, which needs no connection at all.
   */
  readonly target: string | null;
  /** Where the snapshots were read from, for a report the user has to be able to retrace. */
  readonly storeLocation: string;
  /** Path written by this run, or `null` when diagnosing from stored snapshots only. */
  readonly savedLocation: string | null;
  /**
   * `owner/repo` that was searched, or `null` when no repository was connected. When there is a
   * named Redis Cause with strong or moderate evidence and no repo was connected, the graph carries
   * a `no-repository-connected` gap. When `--repo` was requested but GitHub failed, the graph carries
   * `github-unavailable` instead — the Redis diagnosis is still produced.
   */
  readonly repository: string | null;
  /**
   * Hours before the anomaly window that were included in the GitHub search. `null` when no
   * repository was connected.
   */
  readonly lookbackHours: number | null;
  readonly snapshots: readonly RedisSnapshot[];
  readonly graph: EvidenceGraph;
  /**
   * Commits that *might* relate to the growth. Empty when no repository was connected, when there
   * were fewer than two snapshots, when the window had no memory growth (lookup skipped), when
   * GitHub failed, or when GitHub returned nothing. Never ranked as a cause.
   */
  readonly commitCandidates: readonly GitCommitCandidate[];
  /**
   * True when a Connected repository was set but GitHub was not contacted because the evidence
   * graph recorded `no-growth-detected`. Exit remains success; this is not `github-unavailable`.
   */
  readonly commitLookupSkippedBecauseNoGrowth: boolean;
  /**
   * The paragraph form of this diagnosis. Always present: either the deterministic template or
   * an LLM wording that passed `validateExplanationAgainstEvidence`. Adds wording, never facts.
   */
  readonly explanation: Explanation;
}
