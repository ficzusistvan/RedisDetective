import type { AlertEvent } from './alert-event.js';
import { WEBHOOK_EVENT_HEADER, WEBHOOK_SIGNATURE_HEADER } from './alert-defaults.js';
import type { AlertFetch, AlertWait } from './alert-http.js';
import { buildAlertPayload } from './build-alert-payload.js';
import { isChannelEnabled } from './channel-availability.js';
import type { Notifier, NotifierResult } from './notifier.js';
import {
  dryRunNotifierResult,
  failedNotifierResult,
  sentNotifierResult,
  skippedNotifierResult,
} from './notifier.js';
import { postJsonWithRetry } from './post-json-with-retry.js';
import { redactSecretUrl } from './redact-secret-url.js';
import { signWebhookPayload } from './sign-webhook-payload.js';

export interface WebhookNotifierOptions {
  readonly url: string;
  readonly secret: string | null;
  readonly fetchImpl: AlertFetch;
  readonly wait?: AlertWait;
  readonly dryRun?: boolean;
}

export function createWebhookNotifier(options: WebhookNotifierOptions): Notifier {
  return {
    channel: 'webhook',
    async notify(event: AlertEvent): Promise<NotifierResult> {
      if (!isChannelEnabled('webhook')) {
        return skippedNotifierResult('webhook', 'webhook requires a license (not enforced yet)');
      }
      const body = JSON.stringify(buildAlertPayload(event));
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        [WEBHOOK_EVENT_HEADER]: event.action,
      };
      if (options.secret !== null && options.secret !== '') {
        headers[WEBHOOK_SIGNATURE_HEADER] = signWebhookPayload(body, options.secret);
      }
      if (options.dryRun === true) {
        return dryRunNotifierResult('webhook', body);
      }
      const result = await postJsonWithRetry({
        url: options.url,
        headers,
        body,
        fetchImpl: options.fetchImpl,
        ...(options.wait === undefined ? {} : { wait: options.wait }),
      });
      if (result.ok) {
        return sentNotifierResult('webhook');
      }
      return failedNotifierResult(
        'webhook',
        result.error ?? `Webhook ${redactSecretUrl(options.url)} failed.`,
      );
    },
  };
}
