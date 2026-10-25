import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { signWebhookPayload } from '@redis-detective/alerts';

describe('signWebhookPayload', () => {
  it('returns sha256=<hex> of the exact body', () => {
    const body = '{"schemaVersion":1}';
    const expected = createHmac('sha256', 's3cret').update(body).digest('hex');

    expect(signWebhookPayload(body, 's3cret')).toBe(`sha256=${expected}`);
  });

  it('changes when the body or secret changes', () => {
    expect(signWebhookPayload('a', 'k')).not.toBe(signWebhookPayload('b', 'k'));
    expect(signWebhookPayload('a', 'k1')).not.toBe(signWebhookPayload('a', 'k2'));
  });
});
