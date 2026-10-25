import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALERT_CONFIG_FILE_NAMES,
  AlertConfigError,
  DEFAULT_ALERT_STATE_FILE_NAME,
  mergeAlertConfig,
  parseAlertConfigFile,
} from '@redis-detective/alerts';
import type { ResolvedAlertConfig } from '@redis-detective/alerts';

import { hasCiGateThresholds } from './evaluate-ci-gate.js';
import type { CliOptions } from './parse-cli-args.js';
import { CliUsageError } from './parse-cli-args.js';

export interface ResolveAlertConfigRequest {
  readonly options: CliOptions;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly snapshotDirectory?: string | null;
  readonly readFile?: (path: string) => string;
  readonly exists?: (path: string) => boolean;
}

export interface ResolvedAlertConfigWithPath {
  readonly config: ResolvedAlertConfig;
  readonly configPath: string | null;
}

/**
 * Loads an optional config file and merges it with flags / env already on `CliOptions`.
 *
 * A missing default `.redis-detective.json` is not an error. An explicit `--alert-config`
 * that does not exist is a usage error — the operator asked for that file.
 */
export function resolveAlertConfig(
  request: ResolveAlertConfigRequest,
): ResolvedAlertConfigWithPath {
  const cwd = request.cwd ?? process.cwd();
  const exists = request.exists ?? existsSync;
  const readFile = request.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const options = request.options;

  const configPath = resolveConfigPath(options.alertConfigPath, cwd, exists);
  let file = null;
  if (configPath !== null) {
    try {
      file = parseAlertConfigFile(readFile(configPath), configPath, request.env);
    } catch (error) {
      if (error instanceof AlertConfigError) {
        throw new CliUsageError(error.message);
      }
      throw error;
    }
  }

  const snapshotDirectory = request.snapshotDirectory ?? options.snapshotDirectory;
  const stateFile =
    options.alertStateFile ??
    (snapshotDirectory === null ? null : join(snapshotDirectory, DEFAULT_ALERT_STATE_FILE_NAME));

  return {
    configPath,
    config: mergeAlertConfig({
      file,
      cliThresholds: options.gateThresholds,
      cliHasThresholds: hasCiGateThresholds(options.gateThresholds),
      slackWebhookUrl: options.alertSlackWebhook,
      webhookUrl: options.alertWebhookUrl,
      webhookSecret: options.alertWebhookSecret,
      pagerdutyRoutingKey: options.alertPagerdutyRoutingKey,
      pagerdutyEventsUrl: options.alertPagerdutyEventsUrl,
      cooldownMs: options.alertCooldownMs,
      severity: options.alertSeverity,
      pagerdutyMinSeverity: options.alertPagerdutyMinSeverity,
      dryRun: options.alertDryRun,
      stateFile,
    }),
  };
}

function resolveConfigPath(
  explicit: string | null,
  cwd: string,
  exists: (path: string) => boolean,
): string | null {
  if (explicit !== null) {
    if (!exists(explicit)) {
      throw new CliUsageError(`--alert-config file not found: ${explicit}`);
    }
    return explicit;
  }
  for (const name of ALERT_CONFIG_FILE_NAMES) {
    const candidate = join(cwd, name);
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}
