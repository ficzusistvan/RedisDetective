import { defineConfig, mergeConfig } from 'vitest/config';

import shared from './vitest.shared.js';

/** Used only to regenerate golden fixtures: `pnpm exec vitest run --config vitest.scripts.config.ts`. */
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ['scripts/**/*.test.ts'],
    },
  }),
);
