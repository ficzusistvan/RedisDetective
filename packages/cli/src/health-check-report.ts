import type { EvidenceStrength, RedisSnapshot } from '@redis-detective/core-types';

export const HEALTH_FINDING_KINDS = [
  /** A pattern is a large share of estimated memory. */
  'dominant-pattern',
  /** A pattern has no TTL coverage at all — a candidate leak. */
  'no-ttl-coverage',
  /** Some keys under a pattern expire and some do not, which usually means a changed write path. */
  'partial-ttl-coverage',
  /** `used_memory` is close to `maxmemory`. */
  'low-headroom',
  /** RSS well above dataset size; allocator overhead rather than data. */
  'high-fragmentation',
  /** Keys are already being evicted. */
  'evictions-active',
  /** The sample was too thin for the findings to be firm. */
  'thin-sample',
] as const;

export type HealthFindingKind = (typeof HEALTH_FINDING_KINDS)[number];

export interface HealthFinding {
  readonly kind: HealthFindingKind;
  readonly title: string;
  readonly detail: string;
  /** Qualitative only. See the confidence rule in the root AGENTS.md. */
  readonly evidenceStrength: EvidenceStrength;
  readonly recommendedAction: string | null;
}

/**
 * The Phase 1 output: what a single snapshot can honestly support.
 *
 * Deliberately not an `Explanation`. One snapshot shows what is *in* the instance, never why it
 * grew — that needs two snapshots and an `EvidenceGraph`. Keeping the shapes separate stops the
 * health check from drifting into causal claims it cannot back.
 */
export interface HealthCheckReport {
  readonly generatedAt: string;
  /** Password-redacted, always. See `redactRedisUrl`. */
  readonly target: string;
  readonly snapshot: RedisSnapshot;
  readonly findings: readonly HealthFinding[];
  /** Sampling caveats, verbatim from `SamplingMetadata.warnings`. Rendered, never swallowed. */
  readonly caveats: readonly string[];
}
