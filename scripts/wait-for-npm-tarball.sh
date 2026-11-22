#!/usr/bin/env bash
# Poll until an npm package version's tarball actually downloads.
#
# `npm view` can list a version a few minutes before the CDN serves dist.tarball (404). Publishing
# the next package — or ending the release — before the tarball is fetchable leaves installers
# broken. Prefer `npm pack` (registry fetch) and fall back to curling dist.tarball.
#
# Usage: wait-for-npm-tarball.sh <package-name> <version>
# Timeout: ~15 minutes (90 attempts × 10s).

set -euo pipefail

package_name="${1:?package name required}"
version="${2:?version required}"
spec="${package_name}@${version}"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

echo "Waiting until ${spec} tarball downloads…"
for attempt in $(seq 1 90); do
  if (
    cd "$workdir"
    rm -f ./*.tgz
    if npm pack "${spec}" >/dev/null 2>"${workdir}/pack.err"; then
      tarball="$(find . -maxdepth 1 -name '*.tgz' -print -quit)"
      if [ -n "$tarball" ] && [ -s "$tarball" ]; then
        echo "npm pack succeeded for ${spec} ($(wc -c <"$tarball") bytes)."
        exit 0
      fi
    fi

    dist_tarball="$(npm view "${spec}" dist.tarball 2>>"${workdir}/pack.err" || true)"
    if [ -n "${dist_tarball}" ] && curl -fsSL "$dist_tarball" -o "${workdir}/fallback.tgz"; then
      if [ -s "${workdir}/fallback.tgz" ]; then
        echo "Downloaded ${spec} from ${dist_tarball} ($(wc -c <"${workdir}/fallback.tgz") bytes)."
        exit 0
      fi
    fi
    exit 1
  ); then
    exit 0
  fi

  echo "Attempt ${attempt}/90: ${spec} tarball not ready yet; sleeping 10s."
  sleep 10
done

echo "Timed out waiting for ${spec} tarball on npm (~15 min)." >&2
if [ -f "${workdir}/pack.err" ]; then
  cat "${workdir}/pack.err" >&2 || true
fi
exit 1
