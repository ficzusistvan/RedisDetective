# Watch alerts

**Deprecated in 0.7.x.** CLI-hosted Slack / webhook / PagerDuty delivery from `watch`,
and `test-alert` / `alerts test`, still work for the rest of the 0.7 line and are
planned for **removal in 0.8 / 1.0**. Prefer **redis-detective-web** for hosted
alerting (channels, secrets, and history). This repo stays the CLI plus
`@redis-detective/core`: keep using `watch` / `watch --push` to sample and upload,
and the one-shot `--fail-on-*` CI exit-code gate (not deprecated).

`redis-detective watch` can still notify a team when the same thresholds as the CI
gate are crossed. That path is a local loop: the CLI posts to endpoints you
configure. Hosted dashboards and inbox live in the separate private repo
`redis-detective-web`, not in this CLI package.

Threshold math is **not** reimplemented here. Each tick calls
`evaluateCiGate` with the rule's `--fail-on-*` numbers (oldest stored snapshot
versus newest). Core’s `evaluateAlertTick` decides whether to notify, suppress, or
resolve; `packages/alerts` owns delivery I/O.

## Scheduled removal (0.8 / 1.0)

A later major should make this mechanical. Delete or move out of the CLI:

- `packages/alerts` notifiers and HTTP (`slack-notifier.ts`, `webhook-notifier.ts`,
  `pagerduty-notifier.ts`, `create-notifiers.ts`, `post-json-with-retry.ts`,
  `alert-http.ts`, `sign-webhook-payload.ts`, and payload builders that exist only
  to serve those notifiers if the CLI no longer uses them)
- CLI commands and flags: `test-alert` / `alerts test` (`command-from-argv.ts`,
  `run-test-alert.ts`), `--alert-*` / `REDIS_DETECTIVE_SLACK_WEBHOOK` and friends
  (`ALERT_ENV_VARS`), config-file loading for channels (`resolve-alert-config.ts`
  channel parts, `examples/alerts/*` as CLI examples)
- `afterTick` notifier dispatch in `runWatchCommand`; file state store
  `.redis-detective-alerts.json` (`DEFAULT_ALERT_STATE_FILE_NAME`,
  `create-file-alert-state-store.ts`)
- `.github/workflows/alerts-e2e.yml` and `e2e/alerts-*.mjs` once there is no CLI
  channel to test

**Keep in core (not deleted):** `evaluateCiGate`, `evaluateAlertTick`, fingerprints,
state-transition types, finding/rule types.

**Keep in CLI:** `watch` as a sampler, `watch --push` / `push`, one-shot diagnosis,
CI gate exit code (`EXIT_CODES.thresholdExceeded` / 7).

## Quick start

```bash
export REDIS_DETECTIVE_SLACK_WEBHOOK='https://hooks.slack.com/services/…'
redis-detective watch \
  --url redis://localhost:6379 \
  --snapshots ./snaps \
  --interval 15m \
  --fail-on-ttl-drop 20 \
  --fail-on-growth-percent 25 \
  --fail-on-growth-bytes 10485760 \
  --alert-severity critical
```

`--alert-severity` applies to the implicit `cli` rule built from `--fail-on-*`.
Default is `warning`. PagerDuty receives a rule only when its severity is at
least `--alert-pagerduty-min-severity` (default `critical`).

Verify plumbing without waiting for a leak (also deprecated; prefer the web app):

```bash
redis-detective test-alert
# same command:
redis-detective alerts test --alert-dry-run
```

The sample is sent as `critical` so PagerDuty is included even when the default
rule severity is `warning`.

`--alert-dry-run` prints the payloads (Slack Block Kit, versioned webhook JSON,
PagerDuty Events API body with the routing key redacted) and does not POST.

## Channels

### Slack incoming webhook

1. Create an Incoming Webhook for the channel.
2. Set `REDIS_DETECTIVE_SLACK_WEBHOOK` or pass `--alert-slack-webhook`.
3. The message is Block Kit: pattern, what changed, growth bytes/%, TTL
   coverage before/after, Redis-side likely cause, commit hints when the
   diagnosis already had them, and a password-redacted host.

A saved example (not a live webhook) lives at
[`examples/alerts/slack-sample.json`](../examples/alerts/slack-sample.json).

Watch never looks up GitHub. Commit hints appear only if a previous diagnosis
left candidates in memory for that tick — in practice they are empty during
`watch`. Pass `--repo` on a one-shot diagnosis afterwards.

### Generic webhook

`POST` to `--alert-webhook-url` / `REDIS_DETECTIVE_WEBHOOK_URL`.

Headers:

| Header                        | Value                               |
| ----------------------------- | ----------------------------------- |
| `Content-Type`                | `application/json`                  |
| `X-Redis-Detective-Event`     | `firing` or `resolved`              |
| `X-Redis-Detective-Signature` | `sha256=<hex>` when a secret is set |

The body is versioned (`schemaVersion: 1`). Unknown fields should be ignored.
A breaking change bumps `schemaVersion`.

```json
{
  "schemaVersion": 1,
  "event": "firing",
  "occurredAt": "2026-10-25T12:00:00.000Z",
  "host": "redis://:***@cache.internal:6379/",
  "pattern": "session:*",
  "dedupKey": "rdv1:…",
  "rule": { "id": "cli", "kind": "ttl-coverage-drop", "severity": "critical" },
  "change": {
    "summary": "TTL coverage drop",
    "growthBytes": null,
    "growthPercent": null,
    "ttlCoverageBefore": 0.96,
    "ttlCoverageAfter": 0.04
  },
  "likelyCause": { "pattern": "session:*", "description": "…" },
  "commitHints": []
}
```

HMAC-SHA256 is computed over the exact raw JSON bytes with
`--alert-webhook-secret` / `REDIS_DETECTIVE_WEBHOOK_SECRET`. Compare with a
timing-safe equality check.

### PagerDuty Events API v2

Set `REDIS_DETECTIVE_PAGERDUTY_ROUTING_KEY` or
`--alert-pagerduty-routing-key`.

- `event_action` is `trigger` on fire / re-notify, `resolve` when the
  condition clears.
- `dedup_key` is `rdv1:` plus a 40-character hex digest of
  host + pattern + rule id + finding kind. A later process can resolve the
  incident a previous `watch` opened.
- Severity mapping: `critical` → `critical`, `warning` → `warning`,
  `info` → `info`.
- By default only `critical` rules are sent. Lower
  `--alert-pagerduty-min-severity` to page warnings.

`REDIS_DETECTIVE_PAGERDUTY_EVENTS_URL` overrides the enqueue URL (for a mock
server). Production default is `https://events.pagerduty.com/v2/enqueue`.

## Config file

Optional `.redis-detective.json` or `.redis-detective.yaml` in the current
directory, or `--alert-config <file>`. `${ENV_VAR}` placeholders expand from
the environment. An example with two rules is
[`examples/alerts/redis-detective.yaml`](../examples/alerts/redis-detective.yaml).

Merge order: defaults < file < flags / `REDIS_DETECTIVE_*` env vars.

`--fail-on-*` always add a rule named `cli` alongside any file rules, so a
one-off threshold does not erase a documented rule set.

## State machine

Each (host, pattern, rule, finding kind) is an incident:

| Situation                                               | Action                                  |
| ------------------------------------------------------- | --------------------------------------- |
| New breach                                              | `firing` — notify                       |
| Still breaching, inside `--alert-cooldown` (default 1h) | suppress                                |
| Still breaching, cooldown elapsed                       | re-notify                               |
| Breach gone                                             | `resolved` — notify (PagerDuty resolve) |

State is a small JSON file (`<snapshots>/.redis-detective-alerts.json`, or
`--alert-state-file`). A restart inside the cooldown does not re-page. A
corrupt file is treated as empty and logged; `watch` keeps sampling. The last
finding is stored so a resolve event can quote the numbers that tripped, not
zeros.

## Failures

Channel POSTs use a 10s timeout and up to three attempts with exponential
backoff (250ms, 500ms, …). 4xx other than 429 is not retried. Failures are
logged with the URL redacted and never abort the watch loop.

## Secrets

Logs and payloads never include Redis passwords, Slack webhook paths,
PagerDuty routing keys, HMAC secrets, or example key names. The host field is
the same password-redacted URL the rest of the CLI already prints.

## Decision vs delivery

Threshold comparison and the firing → resolved / cooldown state machine live in
`@redis-detective/core` (`evaluateAlertTick`, `transitionAlertState`). Fingerprints
and PagerDuty `dedup_key` values are pure functions there so a restarted process
can close an incident opened by an older CLI. `packages/alerts` owns notifiers,
HTTP (including webhook HMAC), config-file parsing, and the state file.

## Adding a channel later

Notifiers implement a small `Notifier` interface (`packages/alerts`). New hosted
channels belong in redis-detective-web, not as further long-lived CLI delivery.
`isChannelEnabled` is the future license hook; it currently returns `true` for
every shipping channel. Do not add a paywall here. Core must not know about
licences.
