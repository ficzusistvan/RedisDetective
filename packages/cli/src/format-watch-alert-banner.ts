import { configuredChannels } from '@redis-detective/alerts';
import type { ResolvedAlertConfig } from '@redis-detective/alerts';

import { formatDuration } from './format-bytes.js';

export function formatWatchAlertBanner(config: ResolvedAlertConfig): readonly string[] {
  const channels = configuredChannels(config.channels);
  if (channels.length === 0 && config.rules.length === 0) {
    return [];
  }

  const lines: string[] = [];
  if (config.rules.length === 0) {
    lines.push(
      'Alert channels are configured but no rules are armed. Pass --fail-on-* or add rules to --alert-config.',
    );
    return lines;
  }
  if (channels.length === 0 && !config.dryRun) {
    lines.push(
      `Alert rules are armed (${config.rules.map((rule) => rule.id).join(', ')}) but no channel is configured. Add a webhook or use --alert-dry-run.`,
    );
    return lines;
  }

  const channelList = channels.length === 0 ? 'dry-run only' : channels.join(', ');
  const cooldown = config.cooldownMs === 0 ? 'off' : formatDuration(config.cooldownMs / 1_000);
  lines.push(
    `Alerts: ${channelList}. ${String(config.rules.length)} rule(s). Cooldown ${cooldown}.${config.dryRun ? ' Dry-run: payloads print instead of sending.' : ''}`,
  );
  if (config.stateFile !== null) {
    lines.push(`Alert state: ${config.stateFile}`);
  }
  return lines;
}
