# Redis Memory Diagnosis

- **Generated:** 2026-08-25T14:00:00.000Z
- **Store:** /Users/istvanficzus/PrivateProjects/RedisDetective/packages/core/fixtures/golden/snapshot-gap
- **Target:** stored snapshots only (no live connection)
- **Window:** 2026-08-25T10:00:00.000Z → 2026-08-25T19:00:00.000Z (2 snapshots)

## Why

Memory grew 115.2 MiB (+200%), below anomaly thresholds (8 MiB and 2%).

Memory grew 115.2 MiB (+200%), below anomaly thresholds (8 MiB and 2%). cache:* contributed the most estimated growth, 120 MiB, as larger values. Across 2 snapshots from 2026-08-25 10:00 UTC to 2026-08-25 19:00 UTC.

**Named cause:** none (unclear evidence)

### What to do

- Snapshot more often so a change can be located to a narrower window.

## Limitations

**No growth found.** Memory grew 115.2 MiB (+200%), below anomaly thresholds (8 MiB and 2%). cache:* contributed the most estimated growth, 120 MiB, as larger values. Across 2 snapshots from 2026-08-25 10:00 UTC to 2026-08-25 19:00 UTC.

**Unobserved interval.** 32400000ms passed between gap-a and gap-b, beyond the 21600000ms limit. This interval was not analysed, because a change anywhere inside it would look the same from the outside. Snapshot more often so a change can be located to a narrower window.

## Latest snapshot

- **Used memory:** 192.0 MB
- **Keys:** 100,000
- **Top pattern:** `cache:*` (~170.0 MB est., TTL 100.0%)
- **Sample:** 1,000 keys (10.0% of key space)

_Figures derived from a bounded sample are estimates, not measurements. Strength is a qualitative band, not a confidence score._

