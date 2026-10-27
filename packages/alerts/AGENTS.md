# AGENTS.md — packages/alerts

## The rule

This package turns **already-evaluated** threshold findings into notifications. It does not
sample Redis, does not call an LLM, and does not re-implement the CI-gate comparison. Findings
arrive as arguments; the CLI obtains them from `evaluateCiGate`.

HTTP is injected (`AlertFetch`). Unit tests never open a socket. Production (`packages/cli`)
passes `globalThis.fetch`. Timeouts, a small retry budget, and backoff live here so a flaky
Slack or PagerDuty endpoint cannot take down a `watch` loop: every notifier returns a result
instead of throwing.

Secrets (webhook URLs, HMAC secrets, PagerDuty routing keys, Redis passwords) are never logged
and never placed in a payload. Payloads name **patterns**, not example keys.

## Why

`watch` is the long-running path. If notifying a team can crash the sampler or spam a channel
every tick, the tool becomes an incident of its own. The state machine (firing → resolved,
dedup, cooldown) and the persisted state file exist so a restart does not re-page, and a
persistent breach does not re-notify until the cooldown elapses.

PagerDuty `dedup_key` is a pure function of host + pattern + rule, so a resolve event can close
the same incident a later process opened.

## Working in here

- **Inject `AlertFetch` and the clock.** `Date.now()` and `globalThis.fetch` are not called
  from business logic; they arrive as arguments.
- **Do not import `@redis-detective/sampler`, `github-integration`, `reasoner`, or an LLM SDK.**
- **Do not invent findings.** If the gate result is empty, the correct action is resolve-or-idle,
  not a guessed alert.
- **Leave the license seam alone.** `isChannelEnabled` is the future hook for paid channels
  (email, Teams, Opsgenie, hosted). Do not add a paywall.
- Tests live in `test/*.test.ts` and inject fakes. No live Slack, PagerDuty, or Redis.
