#!/usr/bin/env bash
# Seed a disposable Redis with the good write path, snapshot, apply the buggy
# write path (session:* loses its TTL), snapshot again, and print the diagnosis.
#
# Usage:
#   ./examples/ttl-drift-demo/run-demo.sh
#   REDIS_URL=redis://127.0.0.1:6379 ./examples/ttl-drift-demo/run-demo.sh
#
# When REDIS_URL is unset the script starts the compose file in this directory
# (Redis on localhost:6380) and tears it down on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO="$(cd "$(dirname "$0")" && pwd)"
SNAPS="${SNAPS:-$(mktemp -d "${TMPDIR:-/tmp}/ttl-drift-demo.XXXXXX")}"
STARTED_COMPOSE=0

run_cli() {
  if [[ -n "${CLI:-}" ]]; then
    # Intentional split: CLI is an override such as `node ./dist/bin.js`.
    # shellcheck disable=SC2086
    $CLI "$@"
  else
    node "$ROOT/packages/cli/dist/bin.js" "$@"
  fi
}

cleanup() {
  if [[ "${STARTED_COMPOSE}" -eq 1 ]]; then
    docker compose -f "$DEMO/docker-compose.yml" down --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${REDIS_URL:-}" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to start the demo Redis, or set REDIS_URL to an existing instance." >&2
    exit 1
  fi
  docker compose -f "$DEMO/docker-compose.yml" up -d --wait
  STARTED_COMPOSE=1
  export REDIS_URL="redis://127.0.0.1:6380"
fi

if [[ ! -f "$ROOT/packages/cli/dist/bin.js" ]]; then
  echo "Building the CLI…"
  (cd "$ROOT" && pnpm build)
fi

if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -u "$REDIS_URL" FLUSHALL >/dev/null
fi

echo "==> good write path (session:* with EX 3600)"
node "$DEMO/write-keys.mjs" --mode good --url "$REDIS_URL"

echo "==> baseline snapshot"
run_cli --url "$REDIS_URL" --snapshots "$SNAPS" --redact-keys --sample-size 400 >/dev/null

echo "==> buggy write path (session:* SET without EX)"
node "$DEMO/write-keys.mjs" --mode buggy --url "$REDIS_URL"

echo "==> diagnose (Markdown + CI gate)"
set +e
run_cli --url "$REDIS_URL" --snapshots "$SNAPS" --redact-keys --sample-size 400 \
  --format markdown \
  --fail-on-ttl-drop 20 \
  --fail-on-new-untimed-patterns \
  --fail-on-growth-percent 25 \
  --fail-on-growth-bytes 10485760
STATUS=$?
set -e

echo
echo "CLI exit $STATUS (7 means the TTL-drift gate failed, which is the point of this demo)."
echo "Snapshots: $SNAPS"
exit "$STATUS"
