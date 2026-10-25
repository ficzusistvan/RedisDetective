import type { AlertEvent } from './alert-event.js';
import { DEFAULT_PAGERDUTY_EVENTS_URL, DEFAULT_PAGERDUTY_MIN_SEVERITY } from './alert-defaults.js';
import type { AlertFetch, AlertWait } from './alert-http.js';
import type { AlertSeverity } from './alert-severity.js';
import { severityMeetsMinimum } from './alert-severity.js';
import { buildPagerdutyEvent } from './build-pagerduty-event.js';
import { isChannelEnabled } from './channel-availability.js';
import type { Notifier, NotifierResult } from './notifier.js';
import {
  dryRunNotifierResult,
  failedNotifierResult,
  sentNotifierResult,
  skippedNotifierResult,
} from './notifier.js';
import { postJsonWithRetry } from './post-json-with-retry.js';

export interface PagerdutyNotifierOptions {
  readonly routingKey: string;
  readonly fetchImpl: AlertFetch;
  readonly eventsUrl?: string;
  readonly minSeverity?: AlertSeverity;
  readonly wait?: AlertWait;
  readonly dryRun?: boolean;
}

export function createPagerdutyNotifier(options: PagerdutyNotifierOptions): Notifier {
  const minSeverity = options.minSeverity ?? DEFAULT_PAGERDUTY_MIN_SEVERITY;
  const eventsUrl = options.eventsUrl ?? DEFAULT_PAGERDUTY_EVENTS_URL;

  return {
    channel: 'pagerduty',
    async notify(event: AlertEvent): Promise<NotifierResult> {
      if (!isChannelEnabled('pagerduty')) {
        return skippedNotifierResult(
          'pagerduty',
          'pagerduty requires a license (not enforced yet)',
        );
      }
      if (!severityMeetsMinimum(event.rule.severity, minSeverity)) {
        return skippedNotifierResult(
          'pagerduty',
          `severity ${event.rule.severity} is below pagerduty minimum ${minSeverity}`,
        );
      }
      const body = JSON.stringify(buildPagerdutyEvent(event, options.routingKey));
      if (options.dryRun === true) {
        return dryRunNotifierResult('pagerduty', redactRoutingKeyInBody(body));
      }
      const result = await postJsonWithRetry({
        url: eventsUrl,
        headers: { 'content-type': 'application/json' },
        body,
        fetchImpl: options.fetchImpl,
        ...(options.wait === undefined ? {} : { wait: options.wait }),
      });
      if (result.ok) {
        return sentNotifierResult('pagerduty');
      }
      return failedNotifierResult(
        'pagerduty',
        result.error ?? 'PagerDuty Events API request failed.',
      );
    },
  };
}

/**
 * Dry-run must not print the routing key. The live POST still includes it — the Events API
 * requires it in the body — but a terminal dump is where keys get pasted into tickets.
 */
export function redactRoutingKeyInBody(body: string): string {
  return body.replace(/"routing_key"\s*:\s*"[^"]*"/g, '"routing_key":"***"');
}
