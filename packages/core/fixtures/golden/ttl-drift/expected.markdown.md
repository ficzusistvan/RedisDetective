# Redis Memory Diagnosis

- **Generated:** 2026-08-25T14:00:00.000Z
- **Store:** <fixtures>/ttl-drift/snapshots
- **Target:** stored snapshots only (no live connection)
- **Window:** 2026-08-25T10:00:00.000Z → 2026-08-25T11:00:00.000Z (2 snapshots)

## Why

session:* TTL coverage fell from 100% to 20%.

session:* TTL coverage fell from 100% to 20% (keys are being written without an expiry). Across the window 2026-08-25 10:00 UTC to 2026-08-25 11:00 UTC.

**Named cause:** none (moderate evidence)

### What to do

- Some writers still set an expiry and others no longer do. Look for a second write path added to this pattern.

## TTL drift

**`session:*`** — fewer keys carry a TTL than before (moderate evidence)

Coverage 100.0% → 20.0%

- TTL coverage for session:* moved from 100.0% to 20.0%, measured across 100 sampled keys before and 100 after.
- Coverage fell by 80.0 percentage points, so some writers still set an expiry and others no longer do.

→ Some writers still set an expiry and others no longer do. Look for a second write path added to this pattern.

## Latest snapshot

- **Used memory:** 66.0 MB
- **Keys:** 100,000
- **Top pattern:** `session:*` (~52.0 MB est., TTL 20.0%)
- **Sample:** 1,000 keys (10.0% of key space)

_Figures derived from a bounded sample are estimates, not measurements. Strength is a qualitative band, not a confidence score._

