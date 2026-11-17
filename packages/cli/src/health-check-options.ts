import type { LibrarySamplingOptions } from './library-sampling-options.js';

export interface HealthCheckOptions extends LibrarySamplingOptions {
  readonly url: string;
  /** ISO-8601 UTC. Defaults to now. Pass a fixed value to make tests reproducible. */
  readonly generatedAt?: string;
}
