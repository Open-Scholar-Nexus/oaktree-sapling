#!/usr/bin/env bash
# Runs oak in a paper's CI. The engine action has already checked out oak at the pinned version;
# this adds typst and the base URL. oak finds the journal repo from pins.yml itself.
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

# The engine action checked out the version the paper pins, so oak never fetches another.
export OAK_USE_RUNNING=1

extra=()

if [ "$verb" = "build" ] || [ "$verb" = "release" ] || [ "$verb" = "assemble" ]; then
  # Previews are served from the domain root, GitHub Pages from /<repo>, and a co-located paper
  # from /<repo>/<id>, where oak assemble mounts it. Its folder is named by its id.
  if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
    base_url=""
  else
    base_url="/${GITHUB_REPOSITORY##*/}"
    if [ "$verb" != "assemble" ] && [ -n "${PAPER_DIR:-}" ] && [ "$PAPER_DIR" != "." ]; then
      base_url="$base_url/${PAPER_DIR##*/}"
    fi
  fi
  extra+=(--base-url "$base_url")
fi

# A paper below the repo root (co-located). "." is oak's default, so it is not passed.
if [ -n "${PAPER_DIR:-}" ] && [ "$PAPER_DIR" != "." ]; then
  case "$verb" in
    build|validate|release|deploy-preview|deposit|post-checks|notify) extra+=(--paper "$PAPER_DIR") ;;
  esac
fi

echo "::group::engine context"
echo "engine dir : $engine"
echo "verb       : $verb"
echo "paper      : ${PAPER_DIR:-.}"
echo "extra args : ${extra[*]:-<none>}"
# Whether each secret is set, never its value.
echo "GH_TOKEN     : ${GH_TOKEN:+present}"
echo "ZENODO_TOKEN : ${ZENODO_TOKEN:+present}"
echo "CLOUDFLARE   : ${CLOUDFLARE_API_TOKEN:+present}"
echo "::endgroup::"

# oak writes the verb's JSON result to OAK_RESULT_FILE; it becomes the action's `result` output.
OAK_RESULT_FILE="$(mktemp)"
export OAK_RESULT_FILE
code=0
node "$engine/dist/cli.cjs" "$@" "${extra[@]}" || code=$?
if [ -n "${GITHUB_OUTPUT:-}" ] && [ -s "$OAK_RESULT_FILE" ]; then
  printf 'result=%s\n' "$(tr -d '\r\n' < "$OAK_RESULT_FILE")" >> "$GITHUB_OUTPUT"
fi
exit "$code"
