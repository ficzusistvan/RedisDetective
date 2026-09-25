# AGENTS.md — Redis Detective

## What this project is

Redis Detective answers **one question**: _why did this Redis instance's memory grow?_ It takes
a sequence of cheap, sampled snapshots of a Redis instance, works out which key pattern is
responsible for the growth (and whether keys are quietly losing their TTLs), and — when a repo is
connected — lists **commit candidates** in that window for a human to inspect. Commits are never
named as the Cause; see [`CONTEXT.md`](CONTEXT.md) and
[`docs/adr/0001-commits-are-never-causes.md`](docs/adr/0001-commits-are-never-causes.md). The
output is a plain-language explanation an on-call engineer can act on, not a dashboard.

**MVP scope is exactly that one question.** Anything else is out of scope for now. Latency
root-cause, eviction root-cause, cost/billing correlation, multi-cloud support and alerting
integrations are explicitly _not_ being built yet — see [`docs/mvp-scope.md`](docs/mvp-scope.md).
If a change only makes sense for one of those, it does not belong in this repo yet.

Phase 1 ships as a standalone read-only CLI (`packages/cli`, "Redis Memory Health Check") that
works against any Redis URL with no signup. GitHub is optional (`--repo`); when connected it lists
commit candidates only — never Causes.

---

## Hard rules

These are constraints, not preferences. Do not relax one because it makes an implementation
easier. If you believe one is wrong, stop and raise it with a human rather than editing around it.

### 1. The sampler never touches production Redis unboundedly

`packages/sampler` must **never** run `KEYS`, `MEMORY USAGE` across all keys, `DEBUG OBJECT`
sweeps, or any other full key-space enumeration against a live instance. Permitted introspection
is only:

- `INFO` (and `INFO <section>`) parsing — O(1), no key-space traversal.
- **Randomized, cursor-bounded `SCAN`** with an explicit `COUNT`, a hard ceiling on total keys
  visited, a hard ceiling on scan passes, and a wall-clock deadline. All four bounds are enforced
  in `resolveSamplerOptions`, which clamps caller input to `SAMPLER_HARD_LIMITS`.
- `TYPE`, `PTTL` and `MEMORY USAGE` **on individually sampled keys only**, with a low `SAMPLES`
  argument.
- `--bigkeys`-style aggregation computed _from the sample_, by key prefix/pattern — never from a
  full scan.

**Why this is non-negotiable:** Redis executes commands on a single thread. `KEYS *` and
`MEMORY USAGE` are O(N) and O(N) respectively over the key space; on a multi-million-key instance
they block every other client for seconds. A memory diagnostic tool that causes a latency incident
while investigating a memory incident is worse than no tool at all. Users will point this at their
production primary on their worst day — the tool must be boring and safe by construction, not by
the operator remembering to pass the right flag. Consequently the safe path is the _default_, the
bounds are clamped rather than merely validated, and every `RedisSnapshot` records what it
actually sampled (`SamplingMetadata`) so downstream code knows it is reasoning about an estimate.

Corollary: because the data is a sample, every derived number is an **estimate**. Say so in types
(`estimateBasis`) and in user-facing output. Never present an extrapolated byte count as measured.

### 2. Only the reasoner talks to an LLM, and only about evidence it was given

`packages/reasoner` is the **only** package permitted to call an LLM. No other package may import
an LLM SDK; ESLint enforces this via `no-restricted-imports`.

Within the reasoner, two further limits apply:

- It **must not fetch its own data.** It receives an `EvidenceGraph` and a `GitCommitCandidate[]`
  as function arguments. It may not open a Redis connection, call the GitHub API, read files, or
  import `@redis-detective/sampler` / `@redis-detective/github-integration`.
- It **must not invent causes.** Every claim in an `Explanation` has to trace back to a node that
  is already present in the `EvidenceGraph` or in the supplied commit candidates, via an
  `ExplanationCitation`. If the evidence does not support a cause, the correct output is an
  explanation that says the evidence is unclear and lists what is missing — not a plausible guess.
  `validateExplanationAgainstEvidence` exists to make this checkable after generation.

**Why:** all causal reasoning that matters is deterministic and lives in `packages/evidence`,
where it can be unit tested. The LLM's job is translation into prose, nothing more. Keeping that
boundary sharp is what makes the product's claims trustworthy and its behaviour reproducible; the
moment the model is allowed to gather or infer facts, we can no longer tell a user why we said
what we said.

### 3. No numeric confidence scores

Do not emit percentages, probabilities, scores out of 100, or any other number that reads as
confidence. Use the qualitative bands only:

```ts
type EvidenceStrength = 'strong' | 'moderate' | 'unclear';
```

**Why:** we have no validation data yet. A number like "87% confident" implies a calibration we
have not earned and cannot defend, and users anchor hard on it. Once we have real accuracy
measurements against actual user feedback, we can revisit — and that decision needs a human, not
an agent.

Measured or clearly-labelled estimated quantities are fine and encouraged: byte deltas, key
counts, TTL coverage fractions, `shareOfAnomalyGrowth`. The rule is about _confidence in a
conclusion_, not about reporting observations.

---

## Code conventions

- **Strict TypeScript.** `strict: true` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax`
  (see `tsconfig.base.json`). Do not loosen these per-package.
- **No `any`.** Use `unknown` at boundaries and narrow it. `@typescript-eslint/no-explicit-any` is
  an error. No `as` casts to paper over a modelling problem, and no `@ts-expect-error` without a
  comment explaining the upstream cause.
- **One exported responsibility per file.** A file exports one function, or one type together with
  the small satellite types that only exist to describe it. The filename matches the export in
  kebab-case (`detect-ttl-drift.ts` exports `detectTtlDrift`). `index.ts` files only re-export.
- **`packages/evidence` is pure.** Small composable functions, no I/O, no clock, no
  `Math.random()`, no ambient state. Timestamps and thresholds arrive as arguments. The same
  snapshots must always produce the same `EvidenceGraph` — that determinism is what makes the
  product debuggable.
- **Dependencies point inwards.** Everything may depend on `core-types`. `evidence` depends only
  on `core-types`. `cli` composes; nothing depends on `cli`.
- **Inject collaborators.** Redis clients, GitHub clients and LLM clients are narrow interfaces
  passed in as arguments (`RedisCommandClient`, `GitHubCommitSource`, `LlmClient`), never
  constructed inside the function that uses them. This is what makes the no-network test rule
  achievable.
- **`readonly` by default** on interface fields and array types, since snapshots and evidence are
  values that get passed around and must not be mutated in place.
- Unimplemented scaffolding throws `NotImplementedError` from `@redis-detective/core-types`. Do
  not replace a stub with a silent empty return — a wrong answer is worse than a loud gap.

## Testing expectations

- `pnpm test` must pass with **no network access and no Redis instance running**. A test that
  needs either is not a unit test and does not belong in `packages/*/test`.
- **`packages/evidence`** carries the heaviest test burden: it is pure, so every detector and
  attribution rule should be tested with hand-written `RedisSnapshot` fixtures, including the
  boring cases (no growth, single snapshot, non-monotonic timestamps, missing patterns).
- **`packages/sampler`** is tested against a fake `RedisCommandClient`. Tests must assert the
  safety bounds hold — that the sampler stops at the key ceiling, respects the deadline, and never
  issues a forbidden command — because those assertions are how hard rule 1 stays true.
- **`packages/reasoner`** tests inject a fake `LlmClient`. Never call a real model in a test.
  Assert on prompt construction and on the validation step that rejects claims absent from the
  evidence — the guard matters more than the prose.
- **`packages/github-integration`** is tested against a fake `GitHubCommitSource`. No live API.
- Tests live in `packages/<name>/test/*.test.ts` and run with Vitest against package sources
  (see `vitest.shared.ts`), so `pnpm test` works without building first.

## Enforcement

`pnpm lint` is not only style checking. `eslint.config.js` encodes the machine-checkable half of
the hard rules above, and a failure there is an architecture violation rather than a nit:

| Rule                                                           | What it catches                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `no-restricted-imports` (all packages but `reasoner`)          | Importing an LLM SDK outside the reasoner.                                                              |
| `no-restricted-imports` / `no-restricted-globals` (`reasoner`) | The reasoner importing `sampler`, `github-integration`, an HTTP client, or using `fetch`.               |
| `no-restricted-properties` (`evidence`)                        | `Date.now()` or `Math.random()` breaking determinism.                                                   |
| `no-restricted-syntax` (`sampler`)                             | Calling `KEYS`/`FLUSHDB`/`EVAL`, or widening the client interface with an unbounded or generic command. |
| `@typescript-eslint/no-explicit-any`                           | `any` anywhere.                                                                                         |

The type system carries the rest: `RedisCommandClient` exposes only permitted commands,
`gradeEvidenceStrength` can only return a qualitative band, and `ReasonerInput` contains data
only — no clients, no fetchers. If you need to defeat one of those types to make something work,
that is the rule talking, not an inconvenience.

## Commands

```bash
pnpm install
pnpm build       # tsc -b across all packages
pnpm typecheck   # build + typecheck tests
pnpm test        # vitest in every package
pnpm lint        # eslint, including the architectural restriction rules
pnpm pack:cli    # bundle the CLI for npm (requires a prior build)
pnpm verify      # lint + typecheck + test + pack:cli
pnpm health-check -- --url redis://localhost:6379
```

The public npm package is `redis-detective`, staged by `pnpm pack:cli` into `packages/cli/publish`.
Internal `@redis-detective/*` packages stay private and are bundled into that tarball. The GitHub
repo may stay private; provenance is omitted in that case. Do not `npm publish` the workspace CLI
package.

From a clone, `pnpm health-check` runs the built CLI. `pnpm pack:cli` is the dry-run of what npm
gets. No unit test in this repo touches the network.

A disposable instance with a planted TTL leak:

```bash
./scripts/seed-demo-redis.sh 6399
pnpm health-check -- --url redis://localhost:6399
redis-cli -p 6399 shutdown nosave
```

`node scripts/evidence-smoke.mjs` prints an `EvidenceGraph` for a synthetic leak, without waiting
between real snapshots.

### Releasing

The npm package is public; this repo can stay private.

1. Bump `version` in `packages/cli/package.json` (and the repo root, to match).
2. GitHub Actions secret `NPM_TOKEN` must be able to publish `redis-detective`.
3. Push a tag `v<that version>` from `main` (`git tag v0.1.0 && git push origin v0.1.0`).

The release workflow runs `pnpm verify`, checks that the tag matches the CLI version, and publishes
`packages/cli/publish`. npm provenance is attached only if the source repository is public.

The README is what npm users see. Keep it operator-facing; contributor and release notes live here.

## Current state

Health check, sampler, evidence, CLI diagnosis, GitHub candidate lookup, and the reasoner
(deterministic paragraph, optional LLM wording behind the validator) are implemented. The `watch`
subcommand runs the diagnosis path on an interval into a local snapshot directory, with no commit
lookup and no model call per tick. See `docs/mvp-scope.md` for build order.
