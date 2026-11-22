# Changelog

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
