import { SAMPLER_DEFAULTS, SAMPLER_HARD_LIMITS } from '@redis-detective/sampler';

import { DEFAULT_COMMIT_LOOKBACK_HOURS } from './commit-lookup-defaults.js';
import { readCliVersion } from './read-cli-version.js';
import { DEFAULT_WATCH_INTERVAL_MS, MIN_WATCH_INTERVAL_MS } from './watch-defaults.js';

export const CLI_NAME = 'redis-detective';

export const CLI_VERSION = readCliVersion();

export const HELP_TEXT = `${CLI_NAME} — Redis Memory Health Check

Read-only. No signup required. Samples your instance and reports what is using memory.
Pass --snapshots to save each sample and, on later runs, name the pattern responsible
for growth. Pass --repo to list commits in that window (GitHub App; optional).
If LLM_API_KEY is set, the diagnosis paragraph is worded by a model from the evidence
only; otherwise a template is used. No API key is required.

Usage
  ${CLI_NAME} [options]
  ${CLI_NAME} --url redis://localhost:6379
  ${CLI_NAME} --url redis://localhost:6379 --json > report.json
  ${CLI_NAME} --url redis://localhost:6379 --snapshots ./snaps
  ${CLI_NAME} --snapshots ./snaps
  ${CLI_NAME} --snapshots ./snaps --repo owner/repo
  ${CLI_NAME} watch --url redis://localhost:6379 --snapshots ./snaps --interval 15m

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

Options
  -u, --url <url>         Redis connection URL. Defaults to $REDIS_URL.
      --json              Emit a machine-readable JSON report instead of text.
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
                          $GITHUB_REPOSITORY when a GitHub App is also configured (CI footnote).
                          Authentication is a GitHub App (GITHUB_APP_ID,
                          GITHUB_APP_INSTALLATION_ID, and a private key), never a personal access token.
                          Those variables are read from the environment, including a .env file in
                          this directory or a parent. Install with Contents: Read and Pull requests:
                          Read; no webhooks needed. Commits listed are candidates, not causes. If
                          GitHub fails, the Redis diagnosis still prints.
      --lookback-hours <n>
                          Hours before the growth window to include in the commit search
                          (default ${String(DEFAULT_COMMIT_LOOKBACK_HOURS)}, i.e. ${String(DEFAULT_COMMIT_LOOKBACK_HOURS / 24)} days). Widen when deploys are rarer. Requires --repo.
  -h, --help              Show this help.
  -V, --version           Show the version.

Safety
  Only INFO, DBSIZE, bounded SCAN, and TYPE/PTTL/MEMORY USAGE on individually sampled keys are
  issued. This tool never runs KEYS and never walks your whole key space, so it is safe to point
  at a production instance. Sampling is bounded by key count, scan passes, sample rate and a
  wall-clock deadline; a --sample-size above the ceiling is reduced and reported, not honoured.

  Every figure derived from the sample is an estimate and is labelled as one.
`;
