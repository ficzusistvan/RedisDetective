/**
 * A threshold crossing the CLI already computed with `evaluateCiGate`.
 *
 * Same shape as `CiGateFinding` on purpose: alerts consume gate output and must not re-run
 * the comparison. Structural typing lets the CLI pass findings through without a mapper that
 * could drift.
 */
export type AlertFinding =
  | {
      readonly kind: 'pattern-growth';
      readonly pattern: string;
      readonly bytesBefore: number;
      readonly bytesAfter: number;
      readonly bytesGrowth: number;
      readonly percentGrowth: number | null;
      readonly growthPercentThreshold: number | null;
      readonly growthBytesThreshold: number | null;
    }
  | {
      readonly kind: 'ttl-coverage-drop';
      readonly pattern: string;
      readonly ttlCoverageBefore: number;
      readonly ttlCoverageAfter: number;
      readonly dropPoints: number;
      readonly thresholdPoints: number;
    }
  | {
      readonly kind: 'new-untimed-pattern';
      readonly pattern: string;
      readonly ttlCoverageAfter: number;
      readonly estimatedBytes: number;
      readonly estimatedKeyCount: number;
    };

export type AlertFindingKind = AlertFinding['kind'];

export const ALERT_FINDING_KINDS = [
  'pattern-growth',
  'ttl-coverage-drop',
  'new-untimed-pattern',
] as const satisfies readonly AlertFindingKind[];
