# AGENTS.md — packages/evidence

## The rule

This package is **pure**. No I/O, no clock, no randomness, no ambient state. Timestamps and
thresholds arrive as arguments; the same snapshots must always produce a byte-identical
`EvidenceGraph`.

`eslint.config.js` enforces the two easy mistakes (`Date.now()`, `Math.random()`) via
`no-restricted-properties`, and the package may depend on nothing but `@redis-detective/core-types`.
The rest is on you: no reading `process.env`, no module-level mutable state, no iteration order that
depends on anything but the input.

Also in force here: **no numeric confidence scores**. `gradeEvidenceStrength` returns an
`EvidenceStrength` and there is deliberately no numeric variant. See the root
[`AGENTS.md`](../../AGENTS.md).

## Why

This is where every causal claim the product makes is actually decided. `packages/reasoner` only
translates what it is given into prose and may not add to it, so if a conclusion is not established
here, no user may ever be told it.

Determinism is what makes that trustworthy in practice:

- **A wrong answer shows up as a failing test.** Every detector can be pinned to hand-written
  snapshots with exact numbers, so a regression in attribution is caught before a user sees it.
- **"Why did you tell me it was `cart:items:*`?" has an answer.** A byte delta between two named
  snapshots, recorded in `observations`, that the user can check against their own `INFO` output.
- **Re-running produces the same citations.** `createEvidenceId` hashes the facts that define a node
  rather than calling `crypto.randomUUID()`, so an `Explanation` written yesterday still points at
  the same evidence today.

## Working in here

- **Detectors say what changed; attribution says why.** Keeping them separate is what lets the graph
  report growth it cannot explain, instead of inventing an explanation for it. Do not let
  `detectMemoryAnomalies` start naming patterns.
- **Never treat a missing pattern as zero.** Absence from a sample means "not visited", not "held
  nothing". Diffing against an assumed zero manufactures growth for anything an earlier scan
  happened to miss. Record it as a `pattern-not-comparable` gap instead.
- **Never assign the remainder to the largest pattern.** Growth that no pattern clears
  `minAttributionShare` for must be left unattributed so `buildEvidenceGraph` records
  `unattributed-growth`. A confident wrong cause is the worst failure this tool has, because someone
  will go and delete keys on the strength of it.
- **Every number is an estimate.** Pattern-level figures come from a sample, so they can disagree
  with the measured `INFO` totals — that is why shares are clamped to `[0, 1]`. Measured `INFO`
  counters are different in kind, which is why anomaly grading passes
  `effectiveSampleRate: 1`: the key sample does not bear on whether `used_memory` moved.
- **Watch for the byte-figure hole.** When `MEMORY USAGE` is blocked, every `estimatedBytes` is zero
  and `bytesMeasured` is `false`. Dividing by that zero total silently drops every attribution, which
  reads to the user as "nothing caused this". `growthBasis` falls back to key counts and records why;
  keep any new share calculation on the same footing.
- **Guard the sampling artefacts in `detectTtlDrift`.** Two of them look exactly like real drift: a
  pattern with a handful of sampled keys swings wildly (hence `MIN_SAMPLED_KEYS`), and short-TTL keys
  are systematically under-represented in any point-in-time sample. Every rule compares coverage
  *between* snapshots rather than against a fixed target, because the second bias is roughly constant
  and so largely cancels in a difference.
- **An empty graph must explain itself.** An `EvidenceGraph` with no findings and no gaps reads as
  "your Redis is fine" whether or not we established that. A flat well-observed window records
  `no-growth-detected`; anything we could not establish records the gap that says so.
- **Sort everything.** Anomalies, drift events, attributions and gaps are all sorted before they are
  returned, so detection order can never leak into output.

## Tests

`test/*.test.ts`, one file per detector, against hand-written `RedisSnapshot` fixtures from
`test/helpers/snapshot-fixture.ts`. This package carries the heaviest test burden in the repo
precisely because it is pure — there is no excuse for an untested branch.

Cover the boring cases as deliberately as the interesting ones: no growth, a single snapshot, an
empty list, non-monotonic timestamps, a shrinking series, a pattern present in only one snapshot,
`MEMORY USAGE` blocked, and a sample too thin to conclude anything. Those are the inputs a real
instance produces on a normal day, and they are where an overclaiming detector shows itself.

`gradeEvidenceStrength` needs every branch tested individually. It is the function most likely to be
quietly "improved" into something that overstates a conclusion.
