import {
  DEFAULT_ALERT_HTTP_BACKOFF_MS,
  DEFAULT_ALERT_HTTP_RETRIES,
  DEFAULT_ALERT_HTTP_TIMEOUT_MS,
} from './alert-defaults.js';
import type { AlertFetch, AlertWait } from './alert-http.js';
import { defaultAlertWait } from './alert-http.js';
import { redactSecretUrl } from './redact-secret-url.js';

export interface PostJsonRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly fetchImpl: AlertFetch;
  readonly wait?: AlertWait;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly backoffMs?: number;
}

export interface PostJsonResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly error: string | null;
}

/**
 * POST JSON with a timeout and a small retry budget.
 *
 * Retries network failures, timeouts, 429, and 5xx. Does not retry other 4xx — those are
 * configuration mistakes (bad webhook, auth) and hammering them will not help. Failures
 * never throw: the watch loop logs `error` (URL already redacted) and continues.
 */
export async function postJsonWithRetry(request: PostJsonRequest): Promise<PostJsonResult> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_ALERT_HTTP_TIMEOUT_MS;
  const retries = request.retries ?? DEFAULT_ALERT_HTTP_RETRIES;
  const backoffMs = request.backoffMs ?? DEFAULT_ALERT_HTTP_BACKOFF_MS;
  const wait = request.wait ?? defaultAlertWait;
  const redacted = redactSecretUrl(request.url);

  let lastError = `POST ${redacted} failed.`;
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await request.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        timeoutMs,
      });
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status, error: null };
      }
      lastError = `POST ${redacted} returned HTTP ${String(response.status)}.`;
      if (!shouldRetryStatus(response.status) || attempt === retries) {
        return { ok: false, status: response.status, error: lastError };
      }
    } catch (error) {
      lastError = describeFetchError(error, redacted);
      if (attempt === retries) {
        return { ok: false, status: lastStatus, error: lastError };
      }
    }
    await wait(backoffMs * 2 ** (attempt - 1));
  }

  return { ok: false, status: lastStatus, error: lastError };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function describeFetchError(error: unknown, redactedUrl: string): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `POST ${redactedUrl} timed out.`;
  }
  return `POST ${redactedUrl} failed to reach the endpoint.`;
}
