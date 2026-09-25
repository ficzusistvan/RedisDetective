#!/usr/bin/env bash
# Seeds a throwaway Redis with a shape that exercises the health check:
# a large cache pattern that expires, a smaller one that has stopped expiring
# (the leak we want reported), and some inert config keys.
#
# Runs on its own port so it can never touch a real instance. Not part of the
# shipped tool — a local fixture for manual verification.
set -euo pipefail

PORT="${1:-6399}"
DIR="$(mktemp -d)"

redis-server --port "$PORT" --save '' --appendonly no --daemonize yes --dir "$DIR"

for _ in $(seq 1 50); do
  redis-cli -p "$PORT" ping >/dev/null 2>&1 && break
  sleep 0.1
done

redis-cli -p "$PORT" flushall >/dev/null

# 6000 session keys, all with a TTL: the healthy cache.
awk 'BEGIN { for (i = 0; i < 6000; i++) printf "SET session:%08x %0*d EX 3600\n", i, 120, i }' \
  | redis-cli -p "$PORT" --pipe >/dev/null

# 1500 cart keys with NO TTL: the leak. Deliberately larger per key.
awk 'BEGIN { for (i = 0; i < 1500; i++) printf "SET cart:items:%08x %0*d\n", i, 900, i }' \
  | redis-cli -p "$PORT" --pipe >/dev/null

# 400 more cart keys that DO have a TTL, so coverage is partial rather than zero.
awk 'BEGIN { for (i = 5000; i < 5400; i++) printf "SET cart:items:%08x %0*d EX 7200\n", i, 900, i }' \
  | redis-cli -p "$PORT" --pipe >/dev/null

# A handful of inert keys that legitimately never expire.
redis-cli -p "$PORT" mset config:flags on config:region eu-west-1 >/dev/null

USED=$(redis-cli -p "$PORT" info memory | awk -F: '/^used_memory:/ { print $2 }' | tr -d '\r')
# Set a ceiling just above current usage so the headroom finding fires.
redis-cli -p "$PORT" config set maxmemory "$((USED * 100 / 85))" >/dev/null
redis-cli -p "$PORT" config set maxmemory-policy noeviction >/dev/null

echo "seeded $(redis-cli -p "$PORT" dbsize) keys on port $PORT (used_memory=${USED})"
