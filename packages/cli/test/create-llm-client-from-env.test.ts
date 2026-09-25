import { describe, expect, it } from 'vitest';

import { createLlmClientFromEnv } from '@redis-detective/cli';

describe('createLlmClientFromEnv', () => {
  it('returns null when no API key is set, which is the Phase 1 default', () => {
    expect(createLlmClientFromEnv({}, async () => ({ status: 200, text: () => Promise.resolve('') }))).toBeNull();
    expect(
      createLlmClientFromEnv({ LLM_API_KEY: '   ' }, async () => ({
        status: 200,
        text: () => Promise.resolve(''),
      })),
    ).toBeNull();
  });

  it('constructs a client when a key is present, without calling fetch yet', () => {
    let called = false;
    const client = createLlmClientFromEnv(
      { LLM_API_KEY: 'sk-test', LLM_MODEL: 'gpt-4o-mini' },
      async () => {
        called = true;
        return { status: 200, text: () => Promise.resolve('') };
      },
    );

    expect(client).not.toBeNull();
    expect(called).toBe(false);
  });
});
