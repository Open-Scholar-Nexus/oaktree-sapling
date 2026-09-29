#!/usr/bin/env bash
# Cuts a release: builds oak and typst, tests them, commits both to a new commit off HEAD,
# tags it and creates the GitHub release. Branches never move. Runs locally or from the
# cut-engine-release workflow [R57].
#
#   scripts/cut-engine-release.sh v0.3.0-dev.4   # pre-release
#   scripts/cut-engine-release.sh v1.2.0
#
# Needs node, npm and an authenticated gh.
set -euo pipefail

version="${1:-}"
cd "$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "::error::version must look like v1.2.0 or v1.2.0-dev.4 (got '${version:-<empty>}')" >&2
  exit 1
fi

# An existing tag is never moved, pre-releases included: a version names one build.
if git rev-parse -q --verify "refs/tags/$version" >/dev/null 2>&1 \
   || git ls-remote --exit-code --tags origin "refs/tags/$version" >/dev/null 2>&1; then
  echo "::error::tag $version already exists, bump the version (dev releases accumulate)" >&2
  exit 1
fi

# The build writes only ignored paths, so the release is exactly HEAD plus the build.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "::error::working tree has uncommitted tracked changes, commit or stash first" >&2
  exit 1
fi
src_sha="$(git rev-parse HEAD)"

# The tests render with the typst that ships [R34] [R66].
typst_version="$(tr -d '[:space:]' < typst.version)"
typst_asset="typst-x86_64-unknown-linux-musl"
echo "fetching typst ${typst_version} (${typst_asset})"
mkdir -p bin
tmp_typst="$(mktemp -d)"
curl -fsSL "https://github.com/typst/typst/releases/download/v${typst_version}/${typst_asset}.tar.xz" \
  | tar -xJ -C "$tmp_typst"
install -m 0755 "$tmp_typst/${typst_asset}/typst" bin/typst
rm -rf "$tmp_typst"
export PATH="$PWD/bin:$PATH"
bin/typst --version

npm ci
npm run typecheck # vitest does not check types
npm run bundle
npm test
npm run build:fixture

# Env vars rather than `git config`, which would stay in a local clone's config.
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-oak-release-bot}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-oak-release-bot@users.noreply.github.com}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
# Unstage on any exit, so the build cannot ride the next local commit onto a branch [R112].
trap 'git reset -q -- dist/cli.cjs bin/typst 2>/dev/null || true' EXIT
git add -f dist/cli.cjs bin/typst
tree="$(git write-tree)"
leaf="$(git commit-tree "$tree" -p "$src_sha" -m "release: $version (engine bundle + typst)")"
git reset -q

git tag -a "$version" -m "$version" "$leaf"
git push origin "refs/tags/$version"

prerelease=()
[[ "$version" == *-* ]] && prerelease=(--prerelease)
if ! gh release create "$version" "${prerelease[@]}" \
  --title "$version" \
  --notes "The build (\`dist/cli.cjs\`, \`bin/typst\`) is committed at this tag."; then
  echo "release creation failed; removing the tag so $version can be cut again" >&2
  git push origin --delete "refs/tags/$version" || true
  git tag -d "$version" || true
  exit 1
fi

echo "cut $version at ${leaf} (source ${src_sha})"
