import type { HealthCheckJson } from './health-check-json.js';
import { toHealthCheckJson } from './health-check-json.js';
import type { HealthCheckOptions } from './health-check-options.js';
import type { LibraryEngineDeps } from './library-engine-deps.js';
import { capturedSamplingFields } from './library-sampling-options.js';
import { redactRedisUrl } from './redact-redis-url.js';
import { runHealthCheck } from './run-health-check.js';
import { withRedisConnection } from './with-redis-connection.js';

export type { HealthCheckOptions as LibraryHealthCheckOptions } from './health-check-options.js';

/**
 * Samples the instance once and returns the same object the CLI prints under `--json`.
 *
 * Connects, samples, disconnects. Does not write files, does not print, and does not read
 * `.env` or `LLM_API_KEY`.
 */
export async function runLibraryHealthCheck(
  options: HealthCheckOptions,
  deps: LibraryEngineDeps = {},
): Promise<HealthCheckJson> {
  const generatedAt = options.generatedAt ?? (deps.now ?? (() => new Date()))().toISOString();
  const target = redactRedisUrl(options.url);
  const sampling = capturedSamplingFields(options);

  return withRedisConnection(
    options.url,
    async (client) =>
      toHealthCheckJson(
        await runHealthCheck({
          client,
          target,
          sampleSize: sampling.sampleSize,
          timeoutMs: sampling.timeoutMs,
          memorySamples: sampling.memorySamples,
          databases: sampling.databases,
          redactKeys: sampling.redactKeys,
          generatedAt,
        }),
      ),
    deps.connect,
  );
}
