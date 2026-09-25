import type { RedisSnapshot, TTLDriftEvent, TtlDriftKind } from '@redis-detective/core-types';

import type { ResolvedEvidenceOptions } from './evidence-options.js';
import { createEvidenceId } from './create-evidence-id.js';
import { describeChange } from './describe-change.js';
import { gradeEvidenceStrength } from './grade-evidence-strength.js';
import { relativeChange } from './relative-change.js';
import { ttlCoverage } from './ttl-coverage.js';

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Coverage at or below this counts as "nothing expires".
 *
 * Not exactly zero: in a sample of a thousand keys a single straggler still carrying a TTL from
 * before a deploy would otherwise stop a total collapse being reported as one.
 */
const NEAR_ZERO_COVERAGE = 0.02;

/**
 * A pattern needs this many sampled keys in *both* snapshots before its coverage is trustworthy.
 *
 * The guard that matters most in this file. With five sampled keys, two of them happening to lack a
 * TTL moves coverage by 40% and looks identical to a write path that broke. Below the floor no event
 * is emitted at all, because a fabricated leak sends someone hunting through a commit history for a
 * bug that was never there.
 */
const MIN_SAMPLED_KEYS = 20;

/** One pattern's TTL-relevant figures within a single snapshot, summed across data types. */
interface PatternObservation {
  readonly snapshot: RedisSnapshot;
  readonly sampledKeyCount: number;
  readonly keysWithTtl: number;
  readonly keysWithoutTtl: number;
  readonly estimatedKeyCount: number;
  readonly estimatedBytes: number;
  readonly medianTtlSeconds: number | null;
}

/**
 * Groups every snapshot's view of each pattern, oldest first.
 *
 * Entries are summed across data types because `TTLDriftEvent` is keyed by pattern alone. A pattern
 * holding both hashes and strings is unusual, but summing keeps the coverage fraction meaningful
 * rather than arbitrarily picking one type's view of it.
 */
function observationsByPattern(
  snapshots: readonly RedisSnapshot[],
): ReadonlyMap<string, readonly PatternObservation[]> {
  const byPattern = new Map<string, PatternObservation[]>();

  for (const snapshot of snapshots) {
    const merged = new Map<string, PatternObservation>();

    for (const stats of snapshot.patterns) {
      const existing = merged.get(stats.pattern);
      merged.set(stats.pattern, {
        snapshot,
        sampledKeyCount: (existing?.sampledKeyCount ?? 0) + stats.sampledKeyCount,
        keysWithTtl: (existing?.keysWithTtl ?? 0) + stats.keysWithTtl,
        keysWithoutTtl: (existing?.keysWithoutTtl ?? 0) + stats.keysWithoutTtl,
        estimatedKeyCount: (existing?.estimatedKeyCount ?? 0) + stats.estimatedKeyCount,
        estimatedBytes: (existing?.estimatedBytes ?? 0) + stats.estimatedBytes,
        // Medians cannot be summed. The larger sample's median is the better estimate of the two.
        medianTtlSeconds:
          existing === undefined || existing.sampledKeyCount < stats.sampledKeyCount
            ? stats.medianTtlSeconds
            : existing.medianTtlSeconds,
      });
    }

    for (const [pattern, observation] of merged) {
      const list = byPattern.get(pattern);
      if (list === undefined) {
        byPattern.set(pattern, [observation]);
      } else {
        list.push(observation);
      }
    }
  }

  return byPattern;
}

interface Classification {
  readonly kind: TtlDriftKind;
  readonly observations: readonly string[];
}

function classify(
  pattern: string,
  first: PatternObservation,
  last: PatternObservation,
  coverageBefore: number,
  coverageAfter: number,
  options: ResolvedEvidenceOptions,
): Classification | null {
  const drop = coverageBefore - coverageAfter;
  const countGrowth = relativeChange(first.estimatedKeyCount, last.estimatedKeyCount);

  const coverageNote = [
    `TTL coverage for ${pattern} moved from ${formatPercent(coverageBefore)} to ${formatPercent(coverageAfter)}, measured across ${first.sampledKeyCount} sampled keys before and ${last.sampledKeyCount} after.`,
  ];

  // Ordered most specific first. A collapse to zero is also a decline, and reporting it as the
  // weaker of the two would understate the clearest signal this product has.
  if (coverageBefore >= options.minTtlCoverageDrop && coverageAfter <= NEAR_ZERO_COVERAGE) {
    return {
      kind: 'ttl-removed',
      observations: [
        ...coverageNote,
        `Keys under ${pattern} carried a TTL and now effectively none do, which is what a SET losing its EX argument or an EXPIRE call being dropped looks like.`,
      ],
    };
  }

  if (drop >= options.minTtlCoverageDrop) {
    return {
      kind: 'ttl-coverage-declining',
      observations: [
        ...coverageNote,
        `Coverage fell by ${(drop * 100).toFixed(1)} percentage points, so some writers still set an expiry and others no longer do.`,
      ],
    };
  }

  if (coverageBefore <= NEAR_ZERO_COVERAGE && coverageAfter <= NEAR_ZERO_COVERAGE) {
    if (countGrowth < options.minGrowthRatio) {
      return null;
    }
    return {
      kind: 'never-expiring-growth',
      observations: [
        ...coverageNote,
        describeChange(
          `estimated key count for ${pattern}`,
          first.estimatedKeyCount,
          last.estimatedKeyCount,
          'keys',
        ),
        `${pattern} has never carried TTLs and is still growing, so nothing will reclaim it.`,
      ],
    };
  }

  const medianBefore = first.medianTtlSeconds;
  const medianAfter = last.medianTtlSeconds;
  if (
    medianBefore !== null &&
    medianAfter !== null &&
    relativeChange(medianBefore, medianAfter) >= options.minGrowthRatio
  ) {
    return {
      kind: 'ttl-lengthened',
      observations: [
        ...coverageNote,
        describeChange(`median TTL for ${pattern}`, medianBefore, medianAfter, 'seconds'),
        'Keys still expire, but they live longer, so the steady-state footprint of this pattern is larger.',
      ],
    };
  }

  return null;
}

/**
 * Detects patterns whose keys have stopped expiring, or started expiring later.
 *
 * The highest-value detector in the product. A `SET` that lost its `EX` argument, or a cache write
 * path that stopped calling `EXPIRE`, grows memory forever and appears in no error log and on no
 * latency graph. It is also the finding most often worth browsing commit candidates against, which
 * is why optional Git lookup is useful at all.
 *
 * Two sampling artefacts look exactly like real drift, and both are handled here rather than left to
 * the reader:
 *
 * 1. A pattern with only a handful of sampled keys swings wildly — `MIN_SAMPLED_KEYS` suppresses
 *    those outright.
 * 2. Short-TTL keys are systematically under-represented in any point-in-time sample, because they
 *    spend less of their life in the key space than long-lived keys do. That biases *absolute*
 *    coverage downward in every snapshot, which is why every rule here compares coverage between
 *    snapshots instead of against a fixed target: the bias is roughly constant, so it largely
 *    cancels in the difference but would badly mislead an absolute threshold.
 */
export function detectTtlDrift(
  snapshots: readonly RedisSnapshot[],
  options: ResolvedEvidenceOptions,
): readonly TTLDriftEvent[] {
  if (snapshots.length < 2) {
    return [];
  }

  const events: TTLDriftEvent[] = [];

  for (const [pattern, observations] of observationsByPattern(snapshots)) {
    const first = observations[0];
    const last = observations[observations.length - 1];
    if (first === undefined || last === undefined || observations.length < 2) {
      continue;
    }
    if (first.snapshot.snapshotId === last.snapshot.snapshotId) {
      continue;
    }

    // Thin samples are dropped, not reported weakly. See MIN_SAMPLED_KEYS.
    if (first.sampledKeyCount < MIN_SAMPLED_KEYS || last.sampledKeyCount < MIN_SAMPLED_KEYS) {
      continue;
    }

    const coverageBefore = ttlCoverage(first.keysWithTtl, first.keysWithoutTtl);
    const coverageAfter = ttlCoverage(last.keysWithTtl, last.keysWithoutTtl);
    if (coverageBefore === null || coverageAfter === null) {
      continue;
    }

    const classification = classify(
      pattern,
      first,
      last,
      coverageBefore,
      coverageAfter,
      options,
    );
    if (classification === null) {
      continue;
    }

    events.push({
      eventId: createEvidenceId('ttl-drift', [
        pattern,
        classification.kind,
        first.snapshot.snapshotId,
        last.snapshot.snapshotId,
      ]),
      pattern,
      kind: classification.kind,
      window: { from: first.snapshot.capturedAt, to: last.snapshot.capturedAt },
      ttlCoverageBefore: coverageBefore,
      ttlCoverageAfter: coverageAfter,
      medianTtlSecondsBefore: first.medianTtlSeconds,
      medianTtlSecondsAfter: last.medianTtlSeconds,
      snapshotIdBefore: first.snapshot.snapshotId,
      snapshotIdAfter: last.snapshot.snapshotId,
      evidenceStrength: gradeEvidenceStrength({
        supportingSnapshotCount: observations.length,
        effectiveSampleRate: Math.min(
          ...observations.map((entry) => entry.snapshot.sampling.effectiveSampleRate),
        ),
        // TTL drift is not a share of anything: it stands on its own rather than accounting for a
        // portion of some larger anomaly. Grading therefore rests on sample quality, snapshot count
        // and corroboration, which are the inputs that actually bear on whether it is real.
        shareOfGrowth: 1,
        sampleTruncated: observations.some((entry) => entry.snapshot.sampling.truncated),
        // Keys that stopped expiring should also show up as growth. When they do, the two readings
        // support each other; when they do not, something else is reclaiming the keys.
        hasCorroboratingSignal:
          relativeChange(first.estimatedKeyCount, last.estimatedKeyCount) >=
            options.minGrowthRatio ||
          relativeChange(first.estimatedBytes, last.estimatedBytes) >= options.minGrowthRatio,
      }),
      observations: classification.observations,
    });
  }

  return events.sort(
    (left, right) =>
      left.pattern.localeCompare(right.pattern) ||
      left.kind.localeCompare(right.kind) ||
      left.eventId.localeCompare(right.eventId),
  );
}
