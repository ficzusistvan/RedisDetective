import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256 of the raw JSON body, rendered as `sha256=<hex>`.
 *
 * The header name is `X-Redis-Detective-Signature`. Receivers should compute the same
 * digest over the exact bytes they read, using a timing-safe compare.
 */
export function signWebhookPayload(body: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${digest}`;
}
