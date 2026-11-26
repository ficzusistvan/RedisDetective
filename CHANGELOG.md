# Changelog

## 0.7.1

Deprecate CLI-hosted alerting UX while keeping it working through 0.7.x.

### Deprecations

- **`watch` Slack / webhook / PagerDuty delivery** and **`test-alert` / `alerts test`** print a
  one-time stderr warning toward redis-detective-web. Removal is planned for 0.8 / 1.0; behaviour
  and payloads are unchanged in 0.7.1.
- Sampling, `watch --push` / `push`, and the one-shot CI `--fail-on-*` gate (exit 7) are **not**
  deprecated.
- `packages/alerts` remains in the workspace. `docs/alerts.md` and `packages/alerts/AGENTS.md`
  list what a later major should delete.

## 0.7.0

Move alert decision math into `@redis-detective/core` (`evaluateAlertTick`, fingerprints,
state transitions). Notifiers, HMAC, config, and state I/O stay in `packages/alerts`.

## 0.6.3

Small wording fix for `@redis-detective/core` and `redis-detective`.

### Diagnosis wording

- **No snake_case metric ids in human output.** Explanation citations, evidence
  observations, and text/markdown reports say “the key count” / “dataset memory”
  instead of interpolating `key_count` or `used_memory_dataset`. Machine `metric`
  fields on the JSON graph are unchanged. Golden prose checks also reject
  camelCase identifiers and leftover template markers.

## 0.6.2

Small wording and release-timing fixes for `@redis-detective/core` and `redis-detective`.

### Diagnosis wording

- **Readable durations.** Gap explanations and other duration prose use human units (`9 h`,
  `6 h`, `45 min`, `1 h 30 min`) via `formatDuration(ms)`. Machine-readable graph fields still
  keep millisecond numbers.
- **No internal kind ids in explanations.** TTL-drift (and anomaly) summaries use plain phrases
  instead of kebab-case kind names such as `ttl-coverage-declining`. The `kind` field on the JSON
  graph is unchanged.

### Packaging

- After each `npm publish`, the release workflow polls until `npm pack <pkg>@<version>` (or the
  `dist.tarball` URL) actually downloads, with a ~15 minute timeout. `redis-detective` publishes
  only after the core tarball is downloadable, and the job ends only after the CLI tarball is
  downloadable — avoiding the 0.6.1 window where `npm view` listed the version but the tarball
  still 404'd.

## 0.6.1

Fixes found while verifying the 0.6.0 publish of `@redis-detective/core` and `redis-detective`.

### Diagnosis wording

- **Snapshot gap above thresholds.** When memory growth clears both anomaly bars but a long gap
  between snapshots blocks analysis, the report no longer claims the rise was “below anomaly
  thresholds”. It states the growth and that the gap prevents attribution.
- **TTL drift without a memory anomaly.** Deterministic explanations now report established TTL
  drift events (pattern + coverage change) instead of saying no TTL drift was found when the
  evidence graph already contains one.

### Packaging

- Golden text/markdown fixtures no longer embed a local absolute store path; they use
  `<fixtures>/<case>/snapshots`. Pack fails if any published file contains `/Users/`, `/home/`,
  or a Windows drive path.
- `SNAPSHOT_FORMAT.md` ships in the published `@redis-detective/core` package.
- Release workflow publishes core with a normal `npm publish`, then waits until
  `npm view @redis-detective/core@<version>` resolves and the tarball downloads before publishing
  `redis-detective`.

## 0.6.0

Initial public `@redis-detective/core` package and matching `redis-detective` CLI release.
