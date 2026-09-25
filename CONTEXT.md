# Redis Detective

Explains why a Redis instance's memory grew, from sampled snapshots and optional Git context.

## Language

**Redis Memory Health Check**:
The title of the CLI's operator-facing report. The product and npm package name is Redis Detective; this is what a run prints, not a second product.
_Avoid_: treating Health Check as a separate product from Redis Detective

**Cause**:
The Redis-side attribution for memory growth: a key pattern plus what changed about it (more keys, bigger values, or TTL drift). Only evidence from Redis snapshots can establish a Cause.
_Avoid_: Commit, pull request, introducer, root cause (when used for Git)

**Commit candidate**:
A Git commit (and optional linked pull request) that falls in the anomaly window or in the Commit lookback before it, and may be worth a human look. Never a Cause. Never ranked by plausibility; listing may group by timing (within the window, then before it) only to make the shortlist scannable.
_Avoid_: Cause, most plausible commit, ranked commit, suspected cause, near (as an undefined window)

**Commit lookback**:
The interval immediately before the anomaly window’s start that widens candidate search. It is not part of the anomaly window and does not extend after the window’s end.
_Avoid_: anomaly window, grace period, after-anomaly window

**Pattern hint**:
A textual coincidence between a Key pattern and a commit message or changed path. Used only to make matching Commit candidates easier to notice; never proof of causation and never Redis evidence.
_Avoid_: evidence, attribution, related commit (when implying ownership of the Cause)

**Connected repository**:
The GitHub `owner/repo` the operator pointed a diagnosis at for Commit candidate lookup. Naming a Connected repository is separate from whether GitHub authentication succeeded.
_Avoid_: Cause, repository connection (when meaning auth), linked repo (ambiguous with PR links)

**Key pattern**:
A grouped key-space prefix or shape inferred from the sample (for example `session:*`), used as the unit of growth attribution.
_Avoid_: Key, glob (when meaning the attributed group)

**TTL drift**:
A named Redis-side mechanism: keys in a pattern losing or lacking expiration in a way that contributes to retained memory.
_Avoid_: Leak (unless clearly synonymous in prose), eviction
