# Sample output

Captured against a real Redis 7 instance (`redis://127.0.0.1:6398`) by
`./examples/ttl-drift-demo/run-demo.sh` on 2026-10-24. Timestamps will differ;
the named pattern and the exit code should not.

CLI exit **7**. Named cause **`session:*`**. Gate findings: pattern memory
growth and TTL coverage drop 100% → 0%.

```markdown
# Redis Memory Diagnosis

- **Target:** redis://127.0.0.1:6398
- **Gate:** fail

## Why

session:* stopped expiring and accounts for most of the memory growth.

**Named cause:** `session:*` (moderate evidence)

session:* grew by +14.5 MiB (100% of the anomaly) by keys stopped expiring.
TTL coverage on that pattern moved from 100% to 0%.

## Gate

**Outcome:** fail

| Pattern     | Rule                  | Detail                                            |
| ----------- | --------------------- | ------------------------------------------------- |
| `session:*` | pattern memory growth | ~25.4 KB est. → ~14.5 MB est.                     |
| `session:*` | TTL coverage drop     | 100.0% → 0.0% (drop 100.0 points, threshold 20.0) |

## TTL drift

**`session:*`** — TTLs disappeared (moderate evidence)

Coverage 100.0% → 0.0%
```
