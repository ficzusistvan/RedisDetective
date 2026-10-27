import {
  createNotifiers,
  emptySampleContext,
  hasAlertChannels,
  sampleAlertEvent,
} from '@redis-detective/alerts';
import type { AlertFetch, AlertWait, ResolvedAlertConfig } from '@redis-detective/alerts';

export interface RunTestAlertRequest {
  readonly config: ResolvedAlertConfig;
  readonly host: string;
  readonly fetchImpl: AlertFetch;
  readonly wait?: AlertWait;
  readonly writeLine: (line: string) => void;
  readonly writeError: (line: string) => void;
}

export interface RunTestAlertResult {
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
}

/**
 * Sends one sample notification per configured channel. Does not sample Redis and does
 * not touch the alert state file — this is a plumbing check, not an incident.
 */
export async function runTestAlert(request: RunTestAlertRequest): Promise<RunTestAlertResult> {
  if (!hasAlertChannels(request.config.channels)) {
    throw new Error('No alert channel is configured.');
  }

  const notifiers = createNotifiers({
    config: request.config,
    fetchImpl: request.fetchImpl,
    ...(request.wait === undefined ? {} : { wait: request.wait }),
  });
  const event = sampleAlertEvent(request.host, emptySampleContext(request.host), 'critical');
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  request.writeLine(
    `Sending a sample ${event.finding.pattern} notification to ${String(notifiers.length)} channel(s).`,
  );

  for (const notifier of notifiers) {
    const result = await notifier.notify(event);
    if (result.dryRunBody !== null) {
      request.writeLine(`--- alert dry-run ${result.channel} ---`);
      request.writeLine(result.dryRunBody);
    }
    if (result.skipped) {
      skipped += 1;
      request.writeLine(
        `test-alert ${result.channel}: skipped${result.error === null ? '' : ` (${result.error})`}`,
      );
      continue;
    }
    if (result.ok) {
      sent += 1;
      request.writeLine(`test-alert ${result.channel}: sent`);
      continue;
    }
    failed += 1;
    request.writeError(`test-alert ${result.channel}: ${result.error ?? 'failed'}\n`);
  }

  return { sent, failed, skipped };
}
