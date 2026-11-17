import type { GitHubFetch } from '@redis-detective/github-integration';
import type { LlmFetch } from '@redis-detective/reasoner';

import type { RedisConnection } from './create-redis-client.js';

/**
 * Test-only seams for the library wrappers. Not part of the published `redis-detective` API:
 * production callers omit this argument, and `api.ts` does not re-export it.
 *
 * Injecting `connect` is how unit tests run a URL-shaped API against a fake Redis with no
 * network. Injecting `llmFetch` / `githubFetch` is how tests cover the explicit LLM and GitHub
 * options without reaching a provider.
 */
export interface LibraryEngineDeps {
  readonly connect?: (url: string, connectTimeoutMs: number) => Promise<RedisConnection>;
  readonly now?: () => Date;
  readonly llmFetch?: LlmFetch;
  readonly githubFetch?: GitHubFetch;
}
