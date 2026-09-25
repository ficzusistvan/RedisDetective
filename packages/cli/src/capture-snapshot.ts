import { sampleRedisState } from '@redis-detective/sampler';
import type { RedisCommandClient, SamplerOptions } from '@redis-detective/sampler';
import type { RedisSnapshot } from '@redis-detective/core-types';

import { redactExampleKeys } from './redact-example-keys.js';

export interface CaptureSnapshotRequest {
  readonly client: RedisCommandClient;
  readonly sampleSize: number | null;
  readonly timeoutMs: number | null;
  readonly memorySamples: number | null;
  readonly databases: readonly number[] | null;
  readonly redactKeys: boolean;
}

/**
 * Only options the user actually set are forwarded, leaving the rest to the sampler's defaults.
 * `resolveSamplerOptions` then clamps whatever arrives. The CLI does not re-check the safety
 * bounds itself, because two copies of a limit is how they drift apart.
 */
export function samplerOptionsFromCli(request: {
  readonly sampleSize: number | null;
  readonly timeoutMs: number | null;
  readonly memorySamples: number | null;
  readonly databases: readonly number[] | null;
}): SamplerOptions {
  return {
    ...(request.sampleSize === null ? {} : { maxSampledKeys: request.sampleSize }),
    ...(request.timeoutMs === null ? {} : { maxDurationMs: request.timeoutMs }),
    ...(request.memorySamples === null ? {} : { memoryUsageSamples: request.memorySamples }),
    ...(request.databases === null ? {} : { databases: request.databases }),
  };
}

/**
 * Samples the instance once and optionally redacts example keys.
 *
 * Shared by the health check and the diagnosis so the two paths cannot sample differently.
 * Redaction happens here, before either path derives findings, because finding text quotes
 * example keys.
 */
export async function captureSnapshot(request: CaptureSnapshotRequest): Promise<RedisSnapshot> {
  const sampled = await sampleRedisState(request.client, samplerOptionsFromCli(request));
  return request.redactKeys ? redactExampleKeys(sampled) : sampled;
}
