import type { AlertEvent } from './alert-event.js';
import type { AlertFetch, AlertWait } from './alert-http.js';
import { buildSlackMessage } from './build-slack-message.js';
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

export interface SlackNotifierOptions {
  readonly webhookUrl: string;
  readonly fetchImpl: AlertFetch;
  readonly wait?: AlertWait;
  readonly dryRun?: boolean;
}

export function createSlackNotifier(options: SlackNotifierOptions): Notifier {
  return {
    channel: 'slack',
    async notify(event: AlertEvent): Promise<NotifierResult> {
      if (!isChannelEnabled('slack')) {
        return skippedNotifierResult('slack', 'slack requires a license (not enforced yet)');
      }
      const body = JSON.stringify(buildSlackMessage(event));
      if (options.dryRun === true) {
        return dryRunNotifierResult('slack', body);
      }
      const result = await postJsonWithRetry({
        url: options.webhookUrl,
        headers: { 'content-type': 'application/json' },
        body,
        fetchImpl: options.fetchImpl,
        ...(options.wait === undefined ? {} : { wait: options.wait }),
      });
      if (result.ok) {
        return sentNotifierResult('slack');
      }
      return failedNotifierResult(
        'slack',
        result.error ?? `Slack webhook ${redactSecretUrl(options.webhookUrl)} failed.`,
      );
    },
  };
}
