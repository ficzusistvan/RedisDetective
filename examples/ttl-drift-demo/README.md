# TTL drift demo

A small, reproducible leak: a write path that used to set `EX` on `session:*`
stops doing so. Redis Detective should name `session:*` as the drifting pattern.

## What it simulates

| Version | `session:*` | `cache:page:*` |
| ------- | ----------- | -------------- |
| good    | `SET` + `EX 3600` (250 keys) | `SET` + `EX 120` |
| buggy   | overwrite without `EX`, plus 320 larger never-expiring keys so memory grows | unchanged |

`write-keys.mjs` is the application. The "code change" is `--mode buggy`.

## Run it

Needs Node 20.11+ and either Docker (for the compose file) or a Redis URL.

```bash
# from the repo root, after pnpm install && pnpm build
./examples/ttl-drift-demo/run-demo.sh
```

Or point at an instance you already have:

```bash
REDIS_URL=redis://127.0.0.1:6379 ./examples/ttl-drift-demo/run-demo.sh
```

The script:

1. Writes keys the good way and takes a snapshot.
2. Overwrites `session:*` without a TTL.
3. Snapshots again and prints the Markdown diagnosis with the CI gate armed.

A successful demo **exits 7** and the report names `session:*` under TTL drift
("TTLs disappeared") and under Gate.

Compose only (Redis on `localhost:6380`):

```bash
docker compose -f examples/ttl-drift-demo/docker-compose.yml up -d
node examples/ttl-drift-demo/write-keys.mjs --mode good --url redis://127.0.0.1:6380
```

## Demo recording

<!-- demo-gif: replace this block with a short terminal capture of run-demo.sh -->

**GIF / recording placeholder.** A 20–30s capture of `./examples/ttl-drift-demo/run-demo.sh`
belongs here: good seed → snapshot → buggy overwrite → diagnosis naming `session:*`.

Record one later with [VHS](https://github.com/charmbracelet/vhs) or asciinema:

```bash
# VHS (install the vhs binary, then)
vhs examples/ttl-drift-demo/demo.tape
# or
asciinema rec --command './examples/ttl-drift-demo/run-demo.sh' demo.cast
```

A starter tape, `demo.tape`, lives next to this README. The CI workflow
`.github/workflows/ttl-drift-demo.yml` runs the same scenario through the
GitHub Action and asserts the gate fails on buggy and passes on good.

The same seed/bug/fix sequence is reused by `e2e/alerts-watch.test.mjs` to
prove `watch` fires once, stays quiet inside `--alert-cooldown`, and sends
resolve after the good write path is restored. See [docs/alerts.md](../../docs/alerts.md).
