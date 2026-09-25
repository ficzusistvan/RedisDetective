import type { EvidenceStrength } from './evidence-strength.js';

export const GROWTH_MECHANISMS = [
  /** More keys of roughly the same size. */
  'more-keys',
  /** The same keys, holding more data. */
  'larger-values',
  /** Keys stopped being reclaimed. Cross-reference the matching `TTLDriftEvent`. */
  'keys-not-expiring',
  /** Sample too thin or too noisy to say which of the above it is. */
  'indeterminate',
] as const;

export type GrowthMechanism = (typeof GROWTH_MECHANISMS)[number];

/**
 * Links an `AnomalyEvent` to the key pattern responsible for it. This is the product's core
 * output: "your memory grew, and `cart:items:*` accounts for most of it".
 */
export interface PatternAttribution {
  readonly attributionId: string;
  readonly anomalyId: string;
  readonly pattern: string;
  readonly mechanism: GrowthMechanism;

  /** Estimated byte growth for this pattern across the anomaly window. */
  readonly bytesGrowth: number;
  readonly keyCountGrowth: number;

  /**
   * This pattern's share of the anomaly's total growth, in `[0, 1]`.
   *
   * A measured proportion of observed growth — NOT a confidence score. Confidence is expressed
   * only by `evidenceStrength`.
   */
  readonly shareOfAnomalyGrowth: number;

  readonly evidenceStrength: EvidenceStrength;
  readonly supportingSnapshotIds: readonly string[];
  readonly observations: readonly string[];
}
