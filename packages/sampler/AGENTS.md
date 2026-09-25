# AGENTS.md — packages/sampler

## The rule

**This package must never enumerate the full key space of a live Redis instance.**

Forbidden, in any code path, under any flag, for any reason:

- `KEYS` (including `KEYS prefix:*`)
- `MEMORY USAGE` iterated over all keys, or over an unbounded key set
- `SCAN` without a hard cap on total keys visited, passes, and wall-clock time
- `DEBUG OBJECT` / `OBJECT ENCODING` sweeps
- `MEMORY DOCTOR` / `MEMORY STATS` in a loop
- `FLUSHDB`, `EXPIRE`, `DEL`, or **any** write command — the sampler is read-only, full stop

Allowed:

- `INFO` / `INFO <section>` — O(1), no key-space traversal
- `DBSIZE` — O(1)
- **Randomized `SCAN`** with an explicit `COUNT`, bounded by `SAMPLER_HARD_LIMITS`
- `TYPE`, `PTTL`, `MEMORY USAGE` on **individually sampled keys only**, with a low `SAMPLES` value

## Why (read this before you "optimise" the sampler)

Redis executes commands on a single thread. `KEYS *` is O(N) over the key space and `MEMORY USAGE`
is O(N) over the value being measured; on a multi-million-key instance either will block every
other client for seconds. Users will point this tool at their production primary during an
incident, from a terminal, at 3am. A memory diagnostic that causes a latency outage while
investigating a memory problem is worse than shipping nothing.

So the safe behaviour is the **default and the ceiling**, not an opt-in:

- `resolveSamplerOptions` **clamps** caller input to `SAMPLER_HARD_LIMITS` rather than validating
  and passing it through. There is intentionally no escape hatch, and adding one — an
  `unsafe: true` flag, an "exact mode", a `force` option — is a hard-rule violation. If exactness
  is genuinely needed one day, that is a human product decision, not a local refactor.
- All four bounds (key ceiling, pass ceiling, sample rate, deadline) are enforced together. Any
  one alone is insufficient: a small `COUNT` with unlimited passes still walks the whole key space.
- Every `RedisSnapshot` carries `SamplingMetadata` recording what was actually visited and whether
  a bound cut sampling short, so downstream code and the user can see they are reading an estimate.

Because the input is a sample, every derived figure is an **estimate**. Set
`estimateBasis: 'sampled-extrapolation'` and never present an extrapolated byte count as measured.

## Working in here

- The Redis connection is an injected `RedisCommandClient`, a deliberately narrow interface that
  offers only the permitted commands. If you find yourself widening it, that is the signal to stop
  and re-read this file. It also means every test runs against a fake — no Redis required.
- Tests must assert the bounds hold: that sampling stops at the key ceiling, honours the deadline,
  and issues no forbidden command. Those assertions are how this rule stays true after we all
  forget it. They live in `test/scan-key-sample.test.ts` under a marked block — if you change the
  scan loop and one of them fails, the loop is wrong, not the test.
- `FakeRedisCommandClient` (exported as `@redis-detective/sampler/testing`) records every command
  issued, which is what makes those assertions possible. It models real `SCAN` cursor paging,
  keys that expire mid-scan, and an instance that blocks `MEMORY USAGE`. Other packages use it too,
  so keep it faithful.
- The clock and the randomness source are injected (`ScanKeySampleDeps`). Nothing in here may read
  `Date.now()` or `Math.random()` directly, or the bound assertions stop being deterministic.
- Degrade, do not fail. If `MEMORY USAGE` is blocked, sampling continues without byte figures and
  records a warning — but it must also set `bytesMeasured: false`, because a zero byte count would
  otherwise be indistinguishable from a measured zero and would silently zero out every
  downstream share calculation.
- See the root [`AGENTS.md`](../../AGENTS.md) for the project-wide rules.
