import { SAMPLER_DEFAULTS, SAMPLER_HARD_LIMITS } from '@redis-detective/sampler';

import { DEFAULT_COMMIT_LOOKBACK_HOURS } from './commit-lookup-defaults.js';
import { readCliVersion } from './read-cli-version.js';
import { DEFAULT_WATCH_INTERVAL_MS, MIN_WATCH_INTERVAL_MS } from './watch-defaults.js';

export const CLI_NAME = 'redis-detective';

export const CLI_VERSION = readCliVersion();

export const HELP_TEXT = `${CLI_NAME} — Redis Memory Health Check

Read-only. No signup required. Samples your instance and reports what is using memory.
Pass --snapshots to save each sample and, on later runs, name the pattern responsible
for growth. Pass --repo to list commits in that window (GitHub App preferred; gh/token
fallback; optional).
If LLM_API_KEY is set, the diagnosis paragraph is worded by a model from the evidence
only; otherwise a template is used. No API key is required.

Usage
  ${CLI_NAME} [options]
  ${CLI_NAME} --url redis://localhost:6379
  ${CLI_NAME} --url redis://localhost:6379 --json > report.json
  ${CLI_NAME} --url redis://localhost:6379 --snapshots ./snaps
  ${CLI_NAME} --snapshots ./snaps
  ${CLI_NAME} --snapshots ./snaps --format markdown
  ${CLI_NAME} --snapshots ./snaps --fail-on-ttl-drop 20 --fail-on-growth-percent 25
  ${CLI_NAME} --snapshots ./snaps --repo owner/repo
  ${CLI_NAME} watch --url redis://localhost:6379 --snapshots ./snaps --interval 15m
  ${CLI_NAME} watch --url redis://localhost:6379 --snapshots ./snaps --fail-on-ttl-drop 20 --alert-slack-webhook "$REDIS_DETECTIVE_SLACK_WEBHOOK"
  ${CLI_NAME} test-alert --alert-slack-webhook "$REDIS_DETECTIVE_SLACK_WEBHOOK"

Commands
  (none)                  Sample once, and with --snapshots diagnose growth against the samples
                          already in the directory. The command that prints a full report.
  watch                   Keep sampling on --interval, saving each sample to --snapshots and
                          printing one line per sample rather than the report, which would
                          flood a terminal over a long session. Requires --url and --snapshots.
                          Ctrl-C stops after the sample in flight and prints a short summary.
                          Coverage of a large key space grows by accumulating bounded samples
                          over time; it is not a reason to raise --timeout.
                          Candidate commits are never looked up while watching, even with
                          --repo, so a session makes no GitHub requests. Run the plain command
                          afterwards on the same --snapshots directory for the full diagnosis
                          and for candidate commits.
                          When --fail-on-* (or an alert config file) is set, each tick reuses
                          the same threshold comparison as the CI gate. A breach notifies the
                          configured channels once, then stays quiet until --alert-cooldown
                          elapses or the condition clears (resolve).
  test-alert              Send one sample notification per configured channel, so a webhook
  alerts test             can be verified without waiting for a real breach. Same flags as
                          watch for channels. Does not sample Redis.

Options
  -u, --url <url>         Redis connection URL. Defaults to $REDIS_URL.
      --json              Emit a machine-readable JSON report instead of text.
                          Same as --format json.
      --format <name>     text (default), json, or markdown. Markdown is for GitHub
                          job summaries and PR comments; it never prints example keys.
      --write-json <file> Also write the JSON report to a file. Stdout still follows
                          --format, so CI can keep Markdown on stdout and JSON on disk
                          from a single sample.
      --sample-size <n>   Keys to sample. Clamped to a safe ceiling (default 1000).
      --timeout <ms>      Wall-clock budget for sampling, in milliseconds. Clamped to a safe
                          ceiling of ${String(SAMPLER_HARD_LIMITS.maxDurationMs)} (default 10000).
      --memory-samples <n>
                          SAMPLES for MEMORY USAGE on nested values. Clamped to a safe ceiling
                          of ${String(SAMPLER_HARD_LIMITS.maxMemoryUsageSamples)} (default ${String(SAMPLER_DEFAULTS.memoryUsageSamples)}). Lower is cheaper per key but gives less precise
                          byte estimates on large hashes, lists and sorted sets — worth lowering
                          when big values are exhausting the --timeout budget on few keys.
      --interval <dur>    Time between watch samples: 45s, 15m, 2h, or a plain number of
                          seconds. At least ${String(MIN_WATCH_INTERVAL_MS / 1_000)}s, default ${String(DEFAULT_WATCH_INTERVAL_MS / 60_000)}m. Requires the watch command.
      --databases <list>  Comma-separated database indexes to sample (default 0).
      --redact-keys       Replace example key names with a placeholder, for a report you intend
                          to share. Key names often embed user ids or email addresses.
      --snapshots <dir>   Save this sample and diagnose growth against previous samples in the
                          directory. With no --url, diagnose from stored snapshots only — no
                          Redis connection is opened.
      --repo <owner/repo> GitHub repository to search for candidate commits in the growth
                          window (recommended second step after a Redis Cause). Requires
                          --snapshots; reuse the same snapshot directory as the Redis-only pass.
                          Prefer the repo that writes the attributed key pattern. Defaults to
                          $GITHUB_REPOSITORY when a GitHub credential signal is also present
                          (GITHUB_APP_ID and/or GITHUB_TOKEN / GH_TOKEN; CI footnote).
                          Preferred auth is a GitHub App (GITHUB_APP_ID,
                          GITHUB_APP_INSTALLATION_ID, and a private key). Solo fallback: gh auth
                          token, or GITHUB_TOKEN / GH_TOKEN. Credentials come from the environment
                          (including a .env file) or from gh. Install an App with Contents: Read
                          and Pull requests: Read; no webhooks needed. Commits listed are
                          candidates, not causes. Lookup runs only with two or more snapshots and
                          when the window shows memory growth; a flat series skips GitHub (exit 0).
                          If GitHub fails when candidates were expected, the Redis diagnosis still
                          prints (exit 6).
      --skip-gh           Do not consult \`gh auth token\`. Personal credentials are then
                          GITHUB_TOKEN / GH_TOKEN only. REDIS_DETECTIVE_SKIP_GH=1 is the
                          same switch. A complete GitHub App environment is unchanged.
      --lookback-hours <n>
                          Hours before the growth window to include in the commit search
                          (default ${String(DEFAULT_COMMIT_LOOKBACK_HOURS)}, i.e. ${String(DEFAULT_COMMIT_LOOKBACK_HOURS / 24)} days). Widen when deploys are rarer. Requires --repo.
      --fail-on-growth-percent <n>
                          Exit 7 when a compared pattern's estimated bytes grow by more
                          than n percent. Requires --snapshots. When --fail-on-growth-bytes
                          is also set, both must be exceeded (a 2 KB pattern doubling is
                          not a memory incident).
      --fail-on-growth-bytes <n>
                          Exit 7 when a compared pattern's estimated bytes grow by more
                          than n bytes. Requires --snapshots. Combined with
                          --fail-on-growth-percent as a pair; either flag alone trips on
                          that number by itself.
      --fail-on-ttl-drop <n>
                          Exit 7 when a compared pattern's TTL coverage drops by more
                          than n percentage points (20 means 90% → 70%). Requires
                          --snapshots.
      --fail-on-new-untimed-patterns
                          Exit 7 when a pattern first appears with effectively no TTL.
                          Requires --snapshots.
      --warn-only         Report crossed thresholds but still exit 0. Requires --snapshots.
                          Not used by watch (alerts have their own severity).
      --alert-slack-webhook <url>
                          Slack incoming webhook. Env: REDIS_DETECTIVE_SLACK_WEBHOOK.
      --alert-webhook-url <url>
                          Generic webhook. POST a versioned JSON payload (schemaVersion 1).
                          Env: REDIS_DETECTIVE_WEBHOOK_URL.
      --alert-webhook-secret <secret>
                          HMAC-SHA256 of the generic webhook body, sent as
                          X-Redis-Detective-Signature: sha256=<hex>.
                          Env: REDIS_DETECTIVE_WEBHOOK_SECRET.
      --alert-pagerduty-routing-key <key>
                          PagerDuty Events API v2 routing key. Env:
                          REDIS_DETECTIVE_PAGERDUTY_ROUTING_KEY. By default only critical
                          rules are sent (see --alert-pagerduty-min-severity).
      --alert-severity <level>
                          Severity of the implicit CLI rule built from --fail-on-*
                          (info, warning, critical). Default warning. File rules set their
                          own. Env: REDIS_DETECTIVE_ALERT_SEVERITY.
      --alert-pagerduty-min-severity <level>
                          Lowest severity that pages. Default critical.
                          Env: REDIS_DETECTIVE_PAGERDUTY_MIN_SEVERITY.
      --alert-cooldown <dur>
                          Re-notify interval for a persistent breach (45s, 15m, 2h, or
                          seconds). Default 1h. 0 disables the cooldown.
                          Env: REDIS_DETECTIVE_ALERT_COOLDOWN.
      --alert-config <file>
                          JSON or YAML rules file (.redis-detective.json / .yaml).
                          Env: REDIS_DETECTIVE_ALERT_CONFIG. Searched in the current
                          directory when omitted.
      --alert-state-file <file>
                          Where watch persists firing/resolved state so a restart does
                          not re-page. Default: <snapshots>/.redis-detective-alerts.json.
      --alert-dry-run     Print alert payloads instead of sending them.
      --alert-pagerduty-events-url <url>
                          Override the PagerDuty Events API URL (tests / mock servers).
                          Env: REDIS_DETECTIVE_PAGERDUTY_EVENTS_URL.
  -h, --help              Show this help.
  -V, --version           Show the version.

Safety
  Only INFO, DBSIZE, bounded SCAN, and TYPE/PTTL/MEMORY USAGE on individually sampled keys are
  issued. This tool never runs KEYS and never walks your whole key space, so it is safe to point
  at a production instance. Sampling is bounded by key count, scan passes, sample rate and a
  wall-clock deadline; a --sample-size above the ceiling is reduced and reported, not honoured.

  Every figure derived from the sample is an estimate and is labelled as one.
`;
