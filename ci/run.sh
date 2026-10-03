#!/usr/bin/env bash
# Runs oak in a paper's CI. The engine action has already checked out oak at the pinned version
# and set INSTANCE_REPO; this adds typst, the journal repo and the base URL.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
engine="$(cd "$here/.." && pwd)"
verb="${1:-}"

# Only a release tag carries the build, so a missing one means a branch or an unknown ref is
# pinned [R57]. Nothing else rejects a branch pin.
if [ ! -f "$engine/dist/cli.cjs" ]; then
  echo "::error::this oak version has no build (dist/cli.cjs); pin a release tag, not a branch"
  exit 1
fi

# Use the typst shipped with the release when it runs here. It is built for linux x86_64 only [R34].
if [ -x "$engine/bin/typst" ] && "$engine/bin/typst" --version >/dev/null 2>&1; then
  export PATH="$engine/bin:$PATH"
fi

extra=()

if [ "$verb" = "build" ] || [ "$verb" = "release" ]; then
  # Previews are served from the domain root, GitHub Pages from /<repo>.
  if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
    base_url=""
  else
    base_url="/${GITHUB_REPOSITORY##*/}"
  fi
  extra+=(--base-url "$base_url")
fi

# The verbs that read journal settings get a clone of the journal repo [R19] [R27]
# [R189] [R192].
# "." means this repo is the journal, and oak finds it on its own.
if [ "$verb" = "build" ] || [ "$verb" = "release" ] || [ "$verb" = "deploy-preview" ] || [ "$verb" = "validate" ] || [ "$verb" = "deposit" ]; then
  if [ -n "${INSTANCE_REPO:-}" ] && [ "${INSTANCE_REPO}" != "." ]; then
    inst_dir="$(mktemp -d)"
    git clone --depth 1 "https://github.com/${INSTANCE_REPO}.git" "$inst_dir"
    extra+=(--instance "$inst_dir")
  fi
fi

echo "::group::engine context"
echo "engine dir : $engine"
echo "verb       : $verb"
echo "instance   : ${INSTANCE_REPO:-<co-located>}"
echo "extra args : ${extra[*]:-<none>}"
# Whether each secret is set, never its value.
echo "GH_TOKEN     : ${GH_TOKEN:+present}"
echo "ZENODO_TOKEN : ${ZENODO_TOKEN:+present}"
echo "CLOUDFLARE   : ${CLOUDFLARE_API_TOKEN:+present}"
echo "::endgroup::"

exec node "$engine/dist/cli.cjs" "$@" "${extra[@]}"
