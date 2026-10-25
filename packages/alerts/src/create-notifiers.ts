import type { ResolvedAlertConfig } from './alert-config.js';
import type { AlertFetch, AlertWait } from './alert-http.js';
import { isChannelEnabled } from './channel-availability.js';
import type { Notifier } from './notifier.js';
import { createPagerdutyNotifier } from './pagerduty-notifier.js';
import { createSlackNotifier } from './slack-notifier.js';
import { createWebhookNotifier } from './webhook-notifier.js';

export interface CreateNotifiersRequest {
  readonly config: ResolvedAlertConfig;
  readonly fetchImpl: AlertFetch;
  readonly wait?: AlertWait;
}

export function createNotifiers(request: CreateNotifiersRequest): readonly Notifier[] {
  const { config, fetchImpl } = request;
  const dryRun = config.dryRun;
  const wait = request.wait;
  const notifiers: Notifier[] = [];

  if (config.channels.slackWebhookUrl !== null && isChannelEnabled('slack')) {
    notifiers.push(
      createSlackNotifier({
        webhookUrl: config.channels.slackWebhookUrl,
        fetchImpl,
        dryRun,
        ...(wait === undefined ? {} : { wait }),
      }),
    );
  }
  if (config.channels.webhookUrl !== null && isChannelEnabled('webhook')) {
    notifiers.push(
      createWebhookNotifier({
        url: config.channels.webhookUrl,
        secret: config.channels.webhookSecret,
        fetchImpl,
        dryRun,
        ...(wait === undefined ? {} : { wait }),
      }),
    );
  }
  if (config.channels.pagerdutyRoutingKey !== null && isChannelEnabled('pagerduty')) {
    notifiers.push(
      createPagerdutyNotifier({
        routingKey: config.channels.pagerdutyRoutingKey,
        fetchImpl,
        minSeverity: config.pagerdutyMinSeverity,
        dryRun,
        ...(config.channels.pagerdutyEventsUrl === null
          ? {}
          : { eventsUrl: config.channels.pagerdutyEventsUrl }),
        ...(wait === undefined ? {} : { wait }),
      }),
    );
  }

  return notifiers;
}
