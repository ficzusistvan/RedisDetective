# Redis Memory Diagnosis

- **Generated:** 2026-08-25T14:00:00.000Z
- **Store:** /Users/istvanficzus/PrivateProjects/RedisDetective/packages/core/fixtures/golden/below-threshold-growth
- **Target:** stored snapshots only (no live connection)
- **Window:** 2026-08-25T10:00:00.000Z → 2026-08-25T11:00:00.000Z (2 snapshots)

## Why

Memory grew 9 MiB (+1.1%), below anomaly thresholds (8 MiB and 2%).

Memory grew 9 MiB (+1.1%), below anomaly thresholds (8 MiB and 2%). payload:* contributed the most estimated growth, 10 MiB. Across 2 snapshots from 2026-08-25 10:00 UTC to 2026-08-25 11:00 UTC.

**Named cause:** none (unclear evidence)

## Limitations

**No growth found.** Memory grew 9 MiB (+1.1%), below anomaly thresholds (8 MiB and 2%). payload:* contributed the most estimated growth, 10 MiB. Across 2 snapshots from 2026-08-25 10:00 UTC to 2026-08-25 11:00 UTC.

## Latest snapshot

- **Used memory:** 910.0 MB
- **Keys:** 100,000
- **Top pattern:** `payload:*` (~860.0 MB est., TTL 100.0%)
- **Sample:** 1,000 keys (10.0% of key space)

_Figures derived from a bounded sample are estimates, not measurements. Strength is a qualitative band, not a confidence score._

