# Redis Detective

Find out **why** your Redis instance's memory grew — which key pattern (grouped prefix)
accounts for the growth, what changed about it, and whether keys stopped expiring (**TTL
drift**).

No signup. Node 20.11+. Read-only, and safe to point at production. The report the CLI prints
is titled **Redis Memory Health Check**.

```bash
npx redis-detective --url redis://localhost:6379
```

## Install

```bash
npx redis-detective --url redis://localhost:6379
# or keep the binary:
npm install -g redis-detective
redis-detective --url redis://localhost:6379
```

`--url` defaults to `$REDIS_URL`. `--json` writes a machine-readable report. `--redact-keys`
replaces example key names (they often embed user ids) so you can share the output. Prefer a
replica, or a Redis user with a read-only ACL. Run `redis-detective --help` for the rest.

## What is using memory now

One run reports the patterns holding memory, which of them have little or no TTL coverage,
`maxmemory` headroom, fragmentation, and how thin the sample was. Every extrapolated figure is
labelled as an estimate. A single snapshot is "what is in there", not a growth **Cause**.

## Why did it grow

Save each sample and compare:

```bash
redis-detective --url redis://localhost:6379 --snapshots ./snaps
# …time passes, memory grows…
redis-detective --url redis://localhost:6379 --snapshots ./snaps
```

The second run names the **key pattern** that grew, how much of the growth it accounts for, and
the mechanism (more keys, larger values, or **TTL drift**). The report leads with a short
explanation of that evidence; set `LLM_API_KEY` only if you want a model to reword it — without a
key, a template is used.

If the sample could not establish something, the report says so under **Limitations**. Snapshots
are plain JSON. `--snapshots ./snaps` with no `--url` diagnoses from the files alone and does not
open a Redis connection.

## Leaving it running: `watch`

Every sample is bounded, so one run sees a slice of a large key space. More coverage comes from
**more samples over time**, not from a longer deadline — the sampling caps are safety limits, not
tuning knobs. `watch` takes those samples for you:

```bash
redis-detective watch --url redis://localhost:6379 --snapshots ./snaps --interval 15m
```

It prints one line per sample — timestamp, keys sampled, memory in use, and whether that sample's
diagnosis named a cause yet — and nothing else, so a session can run for days in a terminal.
Ctrl-C stops after the sample in flight, so no snapshot file is left half-written, and prints how
many samples the session took. For the full report, run the plain command afterwards on the same
directory:

```bash
redis-detective --snapshots ./snaps
```

`--interval` accepts `45s`, `15m`, `2h`, or a plain number of seconds (minimum 10s, default 15m).
All the sampling flags apply per sample (`--sample-size`, `--timeout`, `--memory-samples`,
`--databases`, `--redact-keys`). Candidate commits are **not** looked up while watching, even if
you pass `--repo`, so a long session makes no GitHub requests — pass `--repo` on the diagnosis run
instead.

This is a local loop writing JSON files to a directory you chose: no daemon, no server, no
retention policy, and nothing leaves the machine.

## Optional: candidate commits (recommended second step)

Redis diagnosis stands alone. When the report names a **Cause** with strong or moderate evidence,
connect a GitHub repo as a second pass so you can inspect **candidate commits** in that window —
never as Causes.

### Two-pass workflow

1. **Pass 1 — Redis only** (during the incident):

   ```bash
   redis-detective --url redis://localhost:6379 --snapshots ./snaps
   ```

2. **Pass 2 — same snapshots + repo** (after the App is set up): reuse the **same**
   `--snapshots` directory so candidates match the growth window you already diagnosed. Prefer no
   live `--url` on this pass.

   ```bash
   redis-detective --snapshots ./snaps --repo owner/repo
   ```

   Choose the repository that **writes the attributed key pattern** (for example the service that
   owns `session:*`), not the repo that merely deploys or hosts Redis. One GitHub App install can
   cover several selected repos under one installation id — vary `--repo` among those repos.

   Optional: `--lookback-hours` (default **168**, i.e. 7 days before the growth window). Widen it
   when deploys are rarer; it is how far to scan, not a confidence dial.

### One-time GitHub App setup (BYO)

Authentication is a **GitHub App**, never a personal access token. Prefer an **org-owned** App
(Settings → Developer settings under the org); a user-owned App is fine for solo projects.

1. Create a GitHub App (org preferred).
2. Set permissions: **Contents: Read**, **Pull requests: Read**.
3. **No webhooks and no callback URL** — this CLI only exchanges an installation token.
4. Install the App on **selected repositories** that own Redis write paths.
5. Copy App id, installation id, and a private key into the environment (or a `.env` in this
   directory or a parent):

   - `GITHUB_APP_ID`
   - `GITHUB_APP_INSTALLATION_ID`
   - exactly one of `GITHUB_APP_PRIVATE_KEY_PATH` or `GITHUB_APP_PRIVATE_KEY_BASE64`

See `.env.example`. The CLI loads `.env` automatically; shell-set variables win.

### Reading the candidate list

Commits listed are **candidate commits**, not **Causes**. A matching key prefix in a path or
message is a **Pattern hint**. The list is ordered **during** the growth first, then **before**
it (Commit lookback) — timing groups for scanning, not a plausibility ranking. Open the linked
commits/PRs and search those diffs for the attributed key pattern or TTL-related writes — still
not proof.

If you passed `--repo` and GitHub auth or the API fails, the Redis diagnosis still prints; the
report records **GitHub unavailable**, candidates stay empty, and the process exits non-zero.

### CI footnote

In GitHub Actions, when a GitHub App is configured, `GITHUB_REPOSITORY` can supply the repo target
during a `--snapshots` diagnosis if you omit `--repo`. Alone (without App env), it does not turn
on GitHub lookup.

## Safety

The tool issues only `INFO`, `SELECT`, `DBSIZE`, bounded `SCAN`, and `TYPE` / `PTTL` /
`MEMORY USAGE` on individually sampled keys. It never runs `KEYS` and never walks the whole key
space. Hard caps (enforced, not optional): at most **10 000** keys sampled per run, a wall-clock
sampling deadline of at most **30 s** (CLI `--timeout` defaults to 10 s and is clamped to that
ceiling), and an oversized `--sample-size` is **reduced**, not honoured. It never deletes keys,
sets TTLs, or writes to Redis.

This CLI does not write to Redis and does not treat commits as the Cause of growth. It does not
alert you either: `watch` accumulates samples in a local directory and says one line about each,
but nothing here decides that something is wrong or tells anyone about it.

## License

Redis Detective is source-available under the [Functional Source License 1.1](https://fsl.software/),
Apache-2.0 eventual license (`FSL-1.1-Apache-2.0`). You may use the CLI for your own Redis
(including in production). You may not offer Redis Detective — or a product with substantially
similar functionality — as a competing commercial hosted service. Each version becomes Apache-2.0
two years after it is published. See [`LICENSE`](LICENSE).

Releases through `0.2.x` remain available under MIT.
