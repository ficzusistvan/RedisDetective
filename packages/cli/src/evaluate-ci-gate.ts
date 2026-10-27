import type { KeyPatternStats, RedisSnapshot } from '@redis-detective/core-types';
import { sortSnapshotsChronologically, ttlCoverage } from '@redis-detective/evidence';

/**
 * Coverage at or below this counts as "nothing expires", matching the evidence detector.
 * A single leftover TTL in a large sample should not hide a write path that dropped `EX`.
 */
export const CI_GATE_NEAR_ZERO_TTL_COVERAGE = 0.02;

/**
 * A pattern needs this many sampled keys on both sides before a comparison is trustworthy.
 * Matches `detectTtlDrift`: five keys swinging by two looks like a leak and is not one.
 */
export const CI_GATE_MIN_SAMPLED_KEYS = 20;

export const CI_GATE_FINDING_KINDS = [
  'pattern-growth',
  'ttl-coverage-drop',
  'new-untimed-pattern',
] as const;

export type CiGateFindingKind = (typeof CI_GATE_FINDING_KINDS)[number];

export const CI_GATE_OUTCOMES = ['pass', 'fail', 'warn', 'skipped'] as const;

export type CiGateOutcome = (typeof CI_GATE_OUTCOMES)[number];

/**
 * Thresholds for a CI gate. `null` / `false` means that rule is off.
 *
 * When both growth thresholds are set, a pattern must exceed **both** to trip the growth rule.
 * That pair is the noise filter: a 2 KB pattern doubling is not a memory incident, and a 50 MB
 * bump that is 3% of a large cache usually is not either. A single threshold, used alone, trips
 * on that number by itself.
 *
 * These are measured/estimated quantities, not confidence scores.
 */
export interface CiGateThresholds {
  /** Estimated-byte growth as a percentage (25 means 25%). */
  readonly growthPercent: number | null;
  /** Estimated-byte growth in bytes. */
  readonly growthBytes: number | null;
  /** TTL coverage drop in percentage points (20 means 20 points, e.g. 90% → 70%). */
  readonly ttlDropPoints: number | null;
  /** Trip when a pattern first appears with effectively no TTL. */
  readonly newUntimedPatterns: boolean;
}

export interface EvaluateCiGateRequest {
  readonly snapshots: readonly RedisSnapshot[];
  readonly thresholds: CiGateThresholds;
  readonly warnOnly: boolean;
  /** Override for tests. Production uses `CI_GATE_MIN_SAMPLED_KEYS`. */
  readonly minSampledKeys?: number;
}

export type CiGateFinding =
  | {
      readonly kind: 'pattern-growth';
      readonly pattern: string;
      readonly bytesBefore: number;
      readonly bytesAfter: number;
      readonly bytesGrowth: number;
      /** `null` when the baseline held 0 estimated bytes, so a percentage is undefined. */
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

export interface CiGateResult {
  readonly outcome: CiGateOutcome;
  readonly warnOnly: boolean;
  readonly comparedSnapshotCount: number;
  readonly baselineSnapshotId: string | null;
  readonly currentSnapshotId: string | null;
  readonly findings: readonly CiGateFinding[];
  readonly notes: readonly string[];
}

interface PatternTotals {
  readonly pattern: string;
  readonly sampledKeyCount: number;
  readonly estimatedBytes: number;
  readonly estimatedKeyCount: number;
  readonly keysWithTtl: number;
  readonly keysWithoutTtl: number;
  readonly bytesMeasured: boolean;
}

/**
 * True when at least one rule is armed. The CLI leaves every rule off unless the operator
 * asked for a gate, so an ordinary diagnosis keeps exiting 0.
 */
export function hasCiGateThresholds(thresholds: CiGateThresholds): boolean {
  return (
    thresholds.growthPercent !== null ||
    thresholds.growthBytes !== null ||
    thresholds.ttlDropPoints !== null ||
    thresholds.newUntimedPatterns
  );
}

export function emptyCiGateThresholds(): CiGateThresholds {
  return {
    growthPercent: null,
    growthBytes: null,
    ttlDropPoints: null,
    newUntimedPatterns: false,
  };
}

/**
 * Compares the oldest snapshot to the newest and reports threshold crossings.
 *
 * Pure: same snapshots and thresholds always produce the same result. Absence of a pattern from
 * one snapshot is not treated as zero — that would invent growth for anything an earlier sample
 * happened to miss. New patterns are a separate rule, and only when they arrive without a TTL.
 */
export function evaluateCiGate(request: EvaluateCiGateRequest): CiGateResult {
  const minSampledKeys = request.minSampledKeys ?? CI_GATE_MIN_SAMPLED_KEYS;
  const ordered =
    request.snapshots.length === 0 ? [] : sortSnapshotsChronologically(request.snapshots);
  const baseline = ordered[0];
  const current = ordered[ordered.length - 1];

  if (baseline === undefined || current === undefined || ordered.length < 2) {
    return {
      outcome: 'skipped',
      warnOnly: request.warnOnly,
      comparedSnapshotCount: ordered.length,
      baselineSnapshotId: baseline?.snapshotId ?? null,
      currentSnapshotId: current?.snapshotId ?? null,
      findings: [],
      notes: [
        ordered.length === 0
          ? 'No snapshots were available to compare.'
          : 'Need two snapshots to compare. This run can be kept as a baseline; run again after memory changes.',
      ],
    };
  }

  const beforeByPattern = totalsByPattern(baseline);
  const afterByPattern = totalsByPattern(current);
  const findings: CiGateFinding[] = [];
  const notes: string[] = [];

  if (current.instance.mode === 'cluster' || current.instance.mode === 'sentinel') {
    notes.push(
      `The current snapshot is a ${current.instance.mode} instance. Redis Detective samples one URL (one node); it does not walk cluster slots or sentinel failovers.`,
    );
  }

  const patternNames = uniqueSorted([...beforeByPattern.keys(), ...afterByPattern.keys()]);

  for (const pattern of patternNames) {
    const before = beforeByPattern.get(pattern);
    const after = afterByPattern.get(pattern);

    if (before !== undefined && after !== undefined) {
      if (before.sampledKeyCount >= minSampledKeys && after.sampledKeyCount >= minSampledKeys) {
        const growth = growthFinding(pattern, before, after, request.thresholds);
        if (growth !== null) {
          findings.push(growth);
        }

        const ttl = ttlDropFinding(pattern, before, after, request.thresholds);
        if (ttl !== null) {
          findings.push(ttl);
        }
      }

      if (request.thresholds.growthPercent !== null || request.thresholds.growthBytes !== null) {
        if (!before.bytesMeasured || !after.bytesMeasured) {
          notes.push(
            `${pattern}: estimated bytes were not measured on at least one snapshot (MEMORY USAGE unavailable), so the growth rule was not applied.`,
          );
        }
      }
    } else if (
      request.thresholds.newUntimedPatterns &&
      before === undefined &&
      after !== undefined &&
      after.sampledKeyCount >= minSampledKeys
    ) {
      const coverage = ttlCoverage(after.keysWithTtl, after.keysWithoutTtl);
      if (coverage !== null && coverage <= CI_GATE_NEAR_ZERO_TTL_COVERAGE) {
        findings.push({
          kind: 'new-untimed-pattern',
          pattern,
          ttlCoverageAfter: coverage,
          estimatedBytes: after.estimatedBytes,
          estimatedKeyCount: after.estimatedKeyCount,
        });
      }
    }
  }

  findings.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.pattern.localeCompare(right.pattern),
  );

  const outcome: CiGateOutcome =
    findings.length === 0 ? 'pass' : request.warnOnly ? 'warn' : 'fail';

  return {
    outcome,
    warnOnly: request.warnOnly,
    comparedSnapshotCount: ordered.length,
    baselineSnapshotId: baseline.snapshotId,
    currentSnapshotId: current.snapshotId,
    findings,
    notes: uniqueSorted(notes),
  };
}

function growthFinding(
  pattern: string,
  before: PatternTotals,
  after: PatternTotals,
  thresholds: CiGateThresholds,
): CiGateFinding | null {
  if (thresholds.growthPercent === null && thresholds.growthBytes === null) {
    return null;
  }
  if (!before.bytesMeasured || !after.bytesMeasured) {
    return null;
  }

  const bytesGrowth = after.estimatedBytes - before.estimatedBytes;
  if (bytesGrowth <= 0) {
    return null;
  }

  const percentGrowth =
    before.estimatedBytes > 0 ? (bytesGrowth / before.estimatedBytes) * 100 : null;
  const percentTripped =
    thresholds.growthPercent !== null &&
    percentGrowth !== null &&
    percentGrowth > thresholds.growthPercent;
  const bytesTripped = thresholds.growthBytes !== null && bytesGrowth > thresholds.growthBytes;

  const tripped =
    thresholds.growthPercent !== null && thresholds.growthBytes !== null
      ? percentTripped && bytesTripped
      : percentTripped || bytesTripped;

  if (!tripped) {
    return null;
  }

  return {
    kind: 'pattern-growth',
    pattern,
    bytesBefore: before.estimatedBytes,
    bytesAfter: after.estimatedBytes,
    bytesGrowth,
    percentGrowth,
    growthPercentThreshold: thresholds.growthPercent,
    growthBytesThreshold: thresholds.growthBytes,
  };
}

function ttlDropFinding(
  pattern: string,
  before: PatternTotals,
  after: PatternTotals,
  thresholds: CiGateThresholds,
): CiGateFinding | null {
  if (thresholds.ttlDropPoints === null) {
    return null;
  }

  const ttlCoverageBefore = ttlCoverage(before.keysWithTtl, before.keysWithoutTtl);
  const ttlCoverageAfter = ttlCoverage(after.keysWithTtl, after.keysWithoutTtl);
  if (ttlCoverageBefore === null || ttlCoverageAfter === null) {
    return null;
  }

  const dropPoints = (ttlCoverageBefore - ttlCoverageAfter) * 100;
  if (dropPoints <= thresholds.ttlDropPoints) {
    return null;
  }

  return {
    kind: 'ttl-coverage-drop',
    pattern,
    ttlCoverageBefore,
    ttlCoverageAfter,
    dropPoints,
    thresholdPoints: thresholds.ttlDropPoints,
  };
}

function totalsByPattern(snapshot: RedisSnapshot): ReadonlyMap<string, PatternTotals> {
  const merged = new Map<string, PatternTotals>();

  for (const stats of snapshot.patterns) {
    const existing = merged.get(stats.pattern);
    merged.set(stats.pattern, addPattern(stats, existing));
  }

  return merged;
}

function addPattern(stats: KeyPatternStats, existing: PatternTotals | undefined): PatternTotals {
  return {
    pattern: stats.pattern,
    sampledKeyCount: (existing?.sampledKeyCount ?? 0) + stats.sampledKeyCount,
    estimatedBytes: (existing?.estimatedBytes ?? 0) + stats.estimatedBytes,
    estimatedKeyCount: (existing?.estimatedKeyCount ?? 0) + stats.estimatedKeyCount,
    keysWithTtl: (existing?.keysWithTtl ?? 0) + stats.keysWithTtl,
    keysWithoutTtl: (existing?.keysWithoutTtl ?? 0) + stats.keysWithoutTtl,
    bytesMeasured: (existing?.bytesMeasured ?? false) || stats.bytesMeasured,
  };
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
