import type { EvidenceStrength } from './evidence-strength.js';
import type { TimeWindow } from './time-window.js';

export const TTL_DRIFT_KINDS = [
  /** Keys under this pattern used to carry a TTL and now do not. The classic silent leak. */
  'ttl-removed',
  /** The share of keys carrying a TTL is falling, without disappearing entirely. */
  'ttl-coverage-declining',
  /** TTLs still exist but are materially longer, so the steady-state footprint is larger. */
  'ttl-lengthened',
  /** A pattern that never had TTLs is growing in key count. */
  'never-expiring-growth',
] as const;

export type TtlDriftKind = (typeof TTL_DRIFT_KINDS)[number];

/**
 * A pattern's expiration behaviour changed over time.
 *
 * Modelled separately from `AnomalyEvent` because it is the highest-value finding the product
 * has: a `SET` that lost its `EX` argument grows memory forever and shows up in no error log.
 */
export interface TTLDriftEvent {
  readonly eventId: string;
  readonly pattern: string;
  readonly kind: TtlDriftKind;
  readonly window: TimeWindow;
  /** Fraction of sampled keys carrying a TTL at the start of the window, in `[0, 1]`. */
  readonly ttlCoverageBefore: number;
  /** Same fraction at the end of the window. */
  readonly ttlCoverageAfter: number;
  readonly medianTtlSecondsBefore: number | null;
  readonly medianTtlSecondsAfter: number | null;
  readonly snapshotIdBefore: string;
  readonly snapshotIdAfter: string;
  readonly evidenceStrength: EvidenceStrength;
  readonly observations: readonly string[];
}
