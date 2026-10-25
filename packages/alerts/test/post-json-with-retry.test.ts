import { describe, expect, it } from 'vitest';

import { postJsonWithRetry } from '@redis-detective/alerts';
import type { AlertFetch } from '@redis-detective/alerts';

describe('postJsonWithRetry', () => {
  it('retries 503 then succeeds', async () => {
    const waits: number[] = [];
    let attempts = 0;
    const fetchImpl: AlertFetch = () => {
      attempts += 1;
      if (attempts < 3) {
        return Promise.resolve({ status: 503, body: 'nope' });
      }
      return Promise.resolve({ status: 200, body: 'ok' });
    };

    const result = await postJsonWithRetry({
      url: 'https://hooks.slack.com/services/T000/B000/secret',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      fetchImpl,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      retries: 3,
      backoffMs: 100,
    });

    expect(result.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('does not retry HTTP 400', async () => {
    let attempts = 0;
    const result = await postJsonWithRetry({
      url: 'https://example.com/hook',
      headers: {},
      body: '{}',
      fetchImpl: () => {
        attempts += 1;
        return Promise.resolve({ status: 400, body: 'bad' });
      },
      wait: () => Promise.resolve(),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(attempts).toBe(1);
  });

  it('redacts the webhook path in the error', async () => {
    const result = await postJsonWithRetry({
      url: 'https://hooks.slack.com/services/T000/B000/secret',
      headers: {},
      body: '{}',
      fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
      wait: () => Promise.resolve(),
      retries: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('https://hooks.slack.com/services/***');
    expect(result.error).not.toContain('secret');
  });
});
