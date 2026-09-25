import type { EvidenceStrength } from './evidence-strength.js';
import type { TimeWindow } from './time-window.js';

export const ANOMALY_KINDS = [
  /** Sustained upward trend across several snapshots. */
  'memory-growth',
  /** A discrete jump between two adjacent snapshots — usually a deploy. */
  'memory-step-change',
  /** RSS pulling away from dataset size; allocator behaviour, not new data. */
  'fragmentation-growth',
  /** More keys, rather than bigger values. */
  'key-count-growth',
  /** Evictions started happening, meaning the instance is already at its ceiling. */
  'eviction-onset',
] as const;

export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

export const ANOMALY_METRICS = [
  'used_memory',
  'used_memory_dataset',
  'used_memory_rss',
  'mem_fragmentation_ratio',
  'key_count',
  'evicted_keys',
] as const;

export type AnomalyMetric = (typeof ANOMALY_METRICS)[number];

/**
 * Something measurably changed. An anomaly says *what* changed and *when*; it deliberately says
 * nothing about *why* — that is what `PatternAttribution` is for.
 */
export interface AnomalyEvent {
  readonly eventId: string;
  readonly kind: AnomalyKind;
  readonly metric: AnomalyMetric;
  readonly window: TimeWindow;
  readonly valueBefore: number;
  readonly valueAfter: number;
  /** Absolute byte delta for memory metrics; `null` for ratios and counts. */
  readonly deltaBytes: number | null;
  readonly snapshotIdBefore: string;
  readonly snapshotIdAfter: string;
  readonly evidenceStrength: EvidenceStrength;
  /** Human-readable notes on how this was detected, for citation in an `Explanation`. */
  readonly observations: readonly string[];
}
