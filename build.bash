#!/usr/bin/env bash
#
# build-site.sh — Build a stitched MyST site from a monorepo
#
# Expected layout:
#   repo-root/
#   ├── myst.yml           # outer website project
#   ├── index.md           # outer site content
#   ├── papers/
#   │   ├── paper-one/     # standalone myst project
#   │   │   ├── myst.yml
#   │   │   └── index.md
#   │   └── paper-two/
#   │       ├── myst.yml
#   │       └── index.md
#
# Usage:
#   ./build-site.sh                            # local, no base url
#   ./build-site.sh --base-url /repo-name      # for GH Pages
#   ./build-site.sh --papers-dir micropubs     # custom papers directory
#   ./build-site.sh --output-dir dist          # custom output directory
#
# Environment:
#   CI=true is set automatically in GitHub Actions.
#   The script uses this to adjust logging (GHA step groups).
#

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────
BASE_URL=""
PAPERS_DIR="papers"
OUTPUT_DIR="_site"

# ── Parse arguments ──────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --base-url)   BASE_URL="$2";     shift 2 ;;
        --papers-dir) PAPERS_DIR="$2";   shift 2 ;;
        --output-dir) OUTPUT_DIR="$2";   shift 2 ;;
        -h|--help)
            sed -n '2,/^$/{ s/^# //; s/^#//; p }' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

REPO_ROOT="$(pwd)"

# ── Helpers ──────────────────────────────────────────────────────────
_is_ci() { [[ "${CI:-}" == "true" ]]; }

# GHA-aware logging: group/endgroup for collapsible sections in Actions
group_start() {
    if _is_ci; then
        echo "::group::$1"
    else
        echo ""
        echo "━━━ $1 ━━━"
    fi
}

group_end() {
    if _is_ci; then
        echo "::endgroup::"
    fi
}

log_ok()   { echo "✅ $1"; }
log_warn() { echo "⚠️  $1"; }
log_err()  { echo "❌ $1" >&2; }
log_skip() { echo "⏭  $1"; }

# ── Config summary ───────────────────────────────────────────────────
echo "🔧 Build config:"
echo "   repo root:   $REPO_ROOT"
echo "   papers dir:  $PAPERS_DIR"
echo "   base_url:    ${BASE_URL:-(none)}"
echo "   output dir:  $OUTPUT_DIR"

# ── 0. Clean previous output ────────────────────────────────────────
if [[ -d "$OUTPUT_DIR" ]]; then
    echo "🗑  Cleaning previous $OUTPUT_DIR"
    rm -rf "$OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"

# ── 1. Build the outer website ──────────────────────────────────────
group_start "Building outer site"

myst clean --yes --exports 2>/dev/null || true

if [[ -n "$BASE_URL" ]]; then
    export BASE_URL
fi

if ! myst build --html; then
    log_err "Outer site build failed"
    group_end
    exit 1
fi

cp -r _build/html/* "$OUTPUT_DIR"/
log_ok "Outer site built"
group_end

# ── 2. Build each paper ─────────────────────────────────────────────
if [[ ! -d "$PAPERS_DIR" ]]; then
    log_warn "No '$PAPERS_DIR' directory found, skipping paper builds"
    echo ""
    log_ok "Done — serve with: npx serve $OUTPUT_DIR"
    exit 0
fi

paper_count=0
fail_count=0

# Save the root-level BASE_URL so we can compute each paper's from it
ROOT_BASE_URL="$BASE_URL"

for paper_path in "$PAPERS_DIR"/*/; do
    # Guard against empty glob
    [[ -d "$paper_path" ]] || continue

    # Skip if not a myst project
    if [[ ! -f "$paper_path/myst.yml" ]]; then
        log_skip "Skipping $paper_path (no myst.yml)"
        continue
    fi

    paper_name="$(basename "$paper_path")"
    group_start "Building paper: $paper_name"

    cd "$paper_path"
    myst clean --yes --exports 2>/dev/null || true

    # Each paper needs its own BASE_URL for correct asset paths
    if [[ -n "$ROOT_BASE_URL" ]]; then
        export BASE_URL="$ROOT_BASE_URL/$PAPERS_DIR/$paper_name"
    else
        export BASE_URL="/$PAPERS_DIR/$paper_name"
    fi

    if myst build --html; then
        dest="$REPO_ROOT/$OUTPUT_DIR/$PAPERS_DIR/$paper_name"
        mkdir -p "$dest"
        cp -r _build/html/* "$dest"/
        log_ok "$paper_name → $OUTPUT_DIR/$PAPERS_DIR/$paper_name"
        paper_count=$((paper_count + 1))
    else
        log_err "Build failed for $paper_name, skipping"
        fail_count=$((fail_count + 1))
    fi

    cd "$REPO_ROOT"
    group_end
done

# ── 3. Summary ───────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_ok "Built outer site + $paper_count paper(s) ($fail_count failed)"
echo "   Output: $OUTPUT_DIR/"
echo ""
echo "   Serve locally with:"
echo "     npx serve $OUTPUT_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Fail the CI job if any paper failed to build
if [[ $fail_count -gt 0 ]]; then
    exit 1
fi