import type { AlertChannel } from './alert-channel.js';
import type { AlertEvent } from './alert-event.js';
import { ruleAppliesToChannel } from './alert-rule.js';
import type { Notifier, NotifierResult } from './notifier.js';

export async function dispatchAlertEvent(
  event: AlertEvent,
  notifiers: readonly Notifier[],
): Promise<readonly NotifierResult[]> {
  const applicable = notifiers.filter((notifier) =>
    ruleAppliesToChannel(event.rule, notifier.channel),
  );
  const results: NotifierResult[] = [];
  for (const notifier of applicable) {
    try {
      results.push(await notifier.notify(event));
    } catch {
      results.push({
        channel: notifier.channel,
        ok: false,
        skipped: false,
        error: `${notifier.channel} notifier threw; the watch loop continues.`,
        dryRunBody: null,
      });
    }
  }
  return results;
}

export function notifiedChannelsOf(results: readonly NotifierResult[]): readonly AlertChannel[] {
  return results.filter((result) => result.ok && !result.skipped).map((result) => result.channel);
}
