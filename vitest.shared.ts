import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageEntry = (packageName: string, subpath = 'index'): string =>
  fileURLToPath(new URL(`./packages/${packageName}/src/${subpath}.ts`, import.meta.url));

/**
 * Tests run against package *sources*, not built output, so `pnpm test` works on a
 * clean checkout without a prior `pnpm build`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@redis-detective/core-types': packageEntry('core-types'),
      // Longest specifier first: Vite matches string aliases by prefix, so a bare
      // '@redis-detective/sampler' entry above this one would swallow the subpath.
      '@redis-detective/sampler/testing': packageEntry('sampler', 'testing/index'),
      '@redis-detective/sampler': packageEntry('sampler'),
      '@redis-detective/evidence': packageEntry('evidence'),
      '@redis-detective/github-integration': packageEntry('github-integration'),
      '@redis-detective/reasoner': packageEntry('reasoner'),
      '@redis-detective/cli': packageEntry('cli'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // No package in this repo is allowed to reach the network from a unit test.
    // reasoner/ must inject a fake LlmClient; sampler/ must inject a fake RedisCommandClient.
    passWithNoTests: false,
  },
});
