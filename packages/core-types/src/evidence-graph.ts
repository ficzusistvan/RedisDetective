import type { AnomalyEvent } from './anomaly-event.js';
import type { EvidenceGap } from './evidence-gap.js';
import type { PatternAttribution } from './pattern-attribution.js';
import type { TimeWindow } from './time-window.js';
import type { TTLDriftEvent } from './ttl-drift-event.js';

/**
 * Everything Redis Detective has deterministically established from a series of snapshots.
 *
 * This is the contract between the deterministic half of the system and the explanatory half.
 * `packages/evidence` is the only producer; `packages/reasoner` is a read-only consumer that may
 * not add to it. If a fact is not in here, it may not appear in an `Explanation`.
 */
export interface EvidenceGraph {
  readonly graphId: string;
  /** ISO-8601 UTC. Supplied by the caller — evidence/ does not read the clock. */
  readonly builtAt: string;
  /** Span covered by the snapshots, not by the analysis run. */
  readonly window: TimeWindow;
  readonly snapshotIds: readonly string[];

  readonly anomalies: readonly AnomalyEvent[];
  readonly attributions: readonly PatternAttribution[];
  readonly ttlDrift: readonly TTLDriftEvent[];

  /** Known holes. An empty graph with a populated `gaps` list is a valid, useful result. */
  readonly gaps: readonly EvidenceGap[];
}
