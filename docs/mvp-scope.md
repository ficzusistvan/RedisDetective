# MVP scope

## The one question

> **Why did this Redis instance's memory grow?**

That is the entire product surface. A useful answer names a **key pattern** (`session:*`,
`cart:items:*`), says **how much** of the growth it accounts for, says **what changed** about it
(more keys, bigger values, or keys that stopped expiring), and — when a repository is connected —
lists **commit candidates** in the growth window or the lookback before it (never ranked or worded as the Cause).

Anything that does not move toward that answer is not in scope yet, however adjacent it looks.

## Definition of done for the MVP

1. An engineer runs one command against a Redis URL and gets a readable report, without signing
   up for anything.
2. Repeated runs over time produce snapshots that can be diffed into an `EvidenceGraph`.
3. The `EvidenceGraph` identifies the key pattern responsible for growth, and flags TTL drift
   (keys losing their expiration) as a distinct, named cause.
4. With a repo connected, the report names candidate commits in the window where the growth began
   (and the lookback before it).
5. Every claim in the report is traceable to a specific piece of evidence, and evidence strength is
   stated qualitatively (`strong` / `moderate` / `unclear`) — never as a number.
6. Nothing the tool does can degrade the Redis instance it is inspecting.

## Explicitly out of scope

Listed so that they can be declined quickly, not because they are bad ideas.

| Out of scope                                                                       | Why not now                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latency root-cause analysis**                                                    | A different question with a different evidence model (slowlog, command stats, per-command latency histograms). It would double the surface area before the first question is answered well. |
| **Eviction root-cause analysis**                                                   | Related to memory but distinct: it is about `maxmemory-policy` behaviour and access patterns, not growth attribution. We _record_ `evicted_keys` as context; we do not diagnose eviction.   |
| **Cost / billing correlation**                                                     | Requires cloud provider billing APIs and pricing models per vendor. Tempting for a business case, orthogonal to the diagnosis.                                                              |
| **Multi-cloud support** (ElastiCache / MemoryDB / Azure Cache / Upstash specifics) | Provider control-plane APIs and metric sources are all different. The MVP speaks plain Redis over a URL, which every one of them supports.                                                  |
| **Alerting / on-call integrations** (PagerDuty, Slack, Opsgenie, webhooks)         | This is a diagnosis tool invoked when something is already wrong, not a monitoring system. Detection-and-notify is a separate product decision.                                             |
| **Hosted monitoring, dashboards, server-side retention**                           | Phase 1 is a local CLI. Storing snapshots _for_ users changes the trust and security model, and is a later phase. The `watch` command is not this: it samples on an interval into a local directory the user chose, with no service, no account and nothing leaving the machine. |
| **Write or remediation actions** (deleting keys, setting TTLs, `MEMORY PURGE`)     | Read-only is a core safety promise. Recommendations are text; the human executes them.                                                                                                      |
| **Cluster-wide topology analysis, slot rebalancing, replication lag**              | Operationally interesting, unrelated to "why did memory grow".                                                                                                                              |
| **Numeric confidence scores / ML ranking of causes**                               | We have no validated accuracy data. See the confidence rule in `AGENTS.md`.                                                                                                                 |

## Build order

Phase 1 is the standalone lead magnet — the read-only **Redis Memory Health Check** CLI. It has to
work on its own, with no account and no GitHub App, because it is what earns the right to ask for
either.

1. **`core-types`** — the shared vocabulary. **Done.**
2. **`sampler`** — safe sampling into a `RedisSnapshot`. **Done:** `INFO` parsing, pattern
   inference, a bounded randomized `SCAN` loop, and extrapolation to the whole key space. All four
   safety bounds are enforced and asserted in tests.
3. **`cli`** — single-snapshot health check: biggest patterns by estimated bytes, TTL coverage,
   fragmentation, `maxmemory` headroom. **Done:** works end to end against a real instance, in text
   and `--json`.
4. **`evidence`** — multi-snapshot diffing: anomaly detection, growth attribution, TTL drift.
   **Done:** five anomaly kinds, four TTL drift kinds, pattern attribution with mechanism
   classification, and gap collection, all pure and deterministic. This is where "why did it grow"
   is actually decided.
5. **`cli` diagnosis** — `--snapshots <dir>` persists each sample as JSON and diffs the series
   through `buildEvidenceGraph`. Offline diagnosis from stored files, no Redis connection, is
   supported. **Done.** The `watch` command runs that same path on an interval, so the series a
   diagnosis needs can accumulate without the user re-running the command by hand.
6. **`github-integration`** — GitHub App auth and candidate commit lookup in the anomaly window
   or the Commit lookback before it. **Done:** App credentials from the environment,
   installation-token exchange, REST commit listing against an injected HTTP client, and candidate
   classification (temporal relation + Pattern hints). `--repo owner/repo` on a diagnosis lists
   candidates without ranking them as causes. When a named Cause has strong or moderate evidence
   and no repo is connected, the report records a `no-repository-connected` gap. If `--repo` is
   set but GitHub fails, the Redis diagnosis still prints with a `github-unavailable` gap
   (non-zero exit).
7. **`reasoner`** — turn an `EvidenceGraph` into prose. **Done:** a deterministic template
   explanation is always produced (`model: null`). If `LLM_API_KEY` is set, an OpenAI-compatible
   client may reword it; `validateExplanationAgainstEvidence` rejects invented patterns, commits,
   uncited claims, overstated strength and numeric confidence, and the CLI falls back to the
   template rather than shipping a bad paragraph.

Phase 1 is complete: `npx redis-detective --url redis://…` produces a report from one snapshot, and
`npx redis-detective --url redis://… --snapshots ./snaps` answers the actual question once two or more
samples exist. `npx redis-detective watch --url redis://… --snapshots ./snaps --interval 15m` takes
those samples on a timer, printing one line each — because coverage of a large key space comes from
accumulating bounded samples, never from loosening a sampling bound. `--repo owner/repo` adds
candidate commits in the growth window, on a diagnosis run only: a watch session never calls GitHub.
The diagnosis opens with a paragraph that restates that evidence (`LLM_API_KEY` optional). The CLI is
published as the single npm package `redis-detective`; workspace packages stay private.

### What the evidence graph establishes

| Detector                    | Answers                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detectMemoryAnomalies`     | Did memory move, and was it a deploy-shaped step or a sustained trend? Also key-count growth, fragmentation with flat data, and the moment evictions began.                  |
| `detectTtlDrift`            | Did a pattern stop expiring, start expiring less often, or start living longer? The highest-value finding, and often the most useful one when browsing commit candidates.     |
| `attributeGrowthToPatterns` | Which pattern accounts for the growth, what share of it, and by what mechanism (more keys, larger values, keys not expiring, or indeterminate).                              |
| `buildEvidenceGraph`        | All of the above, plus the gaps: too few snapshots, too thin a sample, an unobserved interval, growth nothing explains, a pattern that cannot be diffed, or no growth found. |

## Non-goals for the report itself

- No recommendation the user cannot verify from the evidence shown next to it.
- No claim of causality from a single snapshot. One snapshot supports "this is what is in there",
  not "this is why it grew".
- When the evidence is thin, the report says so and says what additional data would help.
