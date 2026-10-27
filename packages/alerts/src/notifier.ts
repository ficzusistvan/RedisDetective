import type { AlertChannel } from './alert-channel.js';
import type { AlertEvent } from './alert-event.js';

export interface NotifierResult {
  readonly channel: AlertChannel;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly error: string | null;
  /** Printed instead of sent when `--alert-dry-run` is set. */
  readonly dryRunBody: string | null;
}

/**
 * One outbound channel. Slack, the generic webhook, and PagerDuty implement this.
 *
 * Paid channels (email, Teams, Opsgenie, a hosted dashboard) should implement the same
 * interface. `isChannelEnabled` is the future license hook; do not add a paywall here.
 */
export interface Notifier {
  readonly channel: AlertChannel;
  notify(event: AlertEvent): Promise<NotifierResult>;
}

export function skippedNotifierResult(
  channel: AlertChannel,
  reason: string | null = null,
): NotifierResult {
  return { channel, ok: true, skipped: true, error: reason, dryRunBody: null };
}

export function failedNotifierResult(channel: AlertChannel, error: string): NotifierResult {
  return { channel, ok: false, skipped: false, error, dryRunBody: null };
}

export function sentNotifierResult(channel: AlertChannel): NotifierResult {
  return { channel, ok: true, skipped: false, error: null, dryRunBody: null };
}

export function dryRunNotifierResult(channel: AlertChannel, body: string): NotifierResult {
  return { channel, ok: true, skipped: false, error: null, dryRunBody: body };
}
