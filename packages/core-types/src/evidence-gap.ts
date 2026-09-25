export const EVIDENCE_GAP_KINDS = [
  /** Fewer than two snapshots, so no growth can be established at all. */
  'insufficient-snapshots',
  /** The sample was too small a fraction of the key space to attribute growth. */
  'sample-too-small',
  /** A long unobserved interval inside the window; the change could have happened anywhere in it. */
  'snapshot-gap',
  /** Growth is real but no single pattern accounts for a meaningful share of it. */
  'unattributed-growth',
  /**
   * The window was observed well enough to draw a conclusion, and the conclusion is that memory did
   * not grow measurably.
   *
   * Recorded explicitly so that "we looked and found nothing" is distinguishable from "we could not
   * tell". An `EvidenceGraph` with no anomalies and no gaps at all would read to a user as a clean
   * bill of health without saying what was examined to earn it.
   */
  'no-growth-detected',
  /** A pattern appears in one snapshot but not another, so it cannot be diffed. */
  'pattern-not-comparable',
  /** No repository connected, so no commit-candidate lookup is possible. */
  'no-repository-connected',
  /**
   * A repository was requested but commit lookup could not run (auth, permissions, API, or
   * rate limit). The Redis diagnosis still stands; candidates are absent.
   */
  'github-unavailable',
] as const;

export type EvidenceGapKind = (typeof EVIDENCE_GAP_KINDS)[number];

/**
 * A known hole in the evidence, recorded explicitly.
 *
 * Gaps are first-class so that a report can say "the evidence is unclear because X" instead of
 * quietly presenting a weak conclusion as a firm one. The reasoner is expected to surface these.
 */
export interface EvidenceGap {
  readonly kind: EvidenceGapKind;
  readonly detail: string;
  /** What would close this gap, phrased as an action the user can take. */
  readonly remedy: string | null;
}
