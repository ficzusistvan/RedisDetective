import type { AlertEvent } from './alert-event.js';
import type { AlertStateTransition } from './alert-state-record.js';
import { describeAlertFindingKind } from './describe-alert-finding.js';
import type { NotifierResult } from './notifier.js';

/**
 * One watch-loop line for an alert decision. Secrets never appear here.
 */
export function formatAlertLine(
  transition: AlertStateTransition,
  event: AlertEvent,
  results: readonly NotifierResult[],
): string | null {
  const kind = describeAlertFindingKind(event.finding);
  const sent = results
    .filter((result) => result.ok && !result.skipped)
    .map((result) => result.channel);
  const failed = results.filter((result) => !result.ok).map((result) => result.channel);
  const skipped = results.filter((result) => result.skipped).map((result) => result.channel);

  switch (transition) {
    case 'notify-firing':
    case 'renotify': {
      const verb = transition === 'renotify' ? 're-notified' : 'firing';
      return `alert ${verb}  ${event.finding.pattern}  ${kind}  ${formatChannels(sent, failed, skipped)}`;
    }
    case 'notify-resolved':
      return `alert resolved  ${event.finding.pattern}  ${kind}  ${formatChannels(sent, failed, skipped)}`;
    case 'suppress':
      return `alert suppressed  ${event.finding.pattern}  ${kind} (cooldown)`;
    case 'none':
      return null;
  }
}

function formatChannels(
  sent: readonly string[],
  failed: readonly string[],
  skipped: readonly string[],
): string {
  const parts: string[] = [];
  if (sent.length > 0) {
    parts.push(sent.join(', '));
  }
  if (failed.length > 0) {
    parts.push(`failed: ${failed.join(', ')}`);
  }
  if (skipped.length > 0 && sent.length === 0 && failed.length === 0) {
    parts.push(`skipped: ${skipped.join(', ')}`);
  }
  return parts.length === 0 ? '(no channel sent)' : `(${parts.join('; ')})`;
}
