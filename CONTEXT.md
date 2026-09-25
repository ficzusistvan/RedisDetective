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
A Git commit (and optional linked pull request) that falls in or near the anomaly window and may be worth a human look. Never a Cause. A matching key-prefix hint is textual coincidence, not proof. Candidates after the growth window are kept and labelled so they can be ruled out, not dropped.
_Avoid_: Cause, most plausible commit, ranked commit, suspected cause

**Key pattern**:
A grouped key-space prefix or shape inferred from the sample (for example `session:*`), used as the unit of growth attribution.
_Avoid_: Key, glob (when meaning the attributed group)

**TTL drift**:
A named Redis-side mechanism: keys in a pattern losing or lacking expiration in a way that contributes to retained memory.
_Avoid_: Leak (unless clearly synonymous in prose), eviction
