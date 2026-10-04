# Releasing oaktree-sapling

A paper's CI runs oak from a checkout of this repository at the version the paper pins, and installs nothing, so the build has to be in the checkout. `scripts/cut-engine-release.sh` puts it there: it commits `dist/cli.cjs` and `bin/typst` to a new commit off HEAD, tags that commit and creates the GitHub release. [How oaktree-sapling is released](https://scholar.nexus/oaktree-sapling/design/releases) has the details.

## Testing a change locally

Build it from your working tree with `npm run bundle` and run `dist/cli.cjs`.

## Testing a change in CI

A local build does not test the composite action's `if:` and `hashFiles` conditions, secrets passed through a step's `env:`, or previews on fork PRs. To test those, make a pre-release named `vX.Y.Z-dev.N` and pin it in the test paper repository. A version with a `-` in it becomes a GitHub pre-release, which keeps it out of `releases/latest`, and conformance accepts no suffix other than `-dev.N`.

```bash
# builds oak and typst, tests them, commits both to a new tagged commit, pushes the tag and creates the GitHub release
scripts/cut-engine-release.sh v0.0.0-dev.25   # needs node, npm and an authenticated gh
# or from Actions: cut-engine-release > Run workflow, with version v0.0.0-dev.25 (ref defaults to the branch it runs from)

# then pin it in the test paper's myst.yml and run its CI
#   project.options.oaktree-sapling.version: v0.0.0-dev.25
```

## Before releasing

Run `npm test` and `npm run build:fixture`. The release script runs both again with the typst in `typst.version`, while locally the PDF test uses the `typst` on `PATH` and skips itself when there is none, so only the release script catches a problem with the pinned typst version.

The script stops before pushing anything if the version is malformed, the tag already exists locally or on `origin`, or tracked files have uncommitted changes.

## After a stable release

A stable `vX.Y.Z` is `latest` as soon as it is released, and conformance runs after ([why](https://scholar.nexus/oaktree-sapling/design/releases#r114)). Wait for the conformance run to pass before announcing the version. If it fails, delete the release or release a newer one.

## Conformance

`conformance.yml` tests a release on the test paper repository named by the `CONFORMANCE_TEST_REPO` variable, with `oak conformance` ([what it runs](https://scholar.nexus/oaktree-sapling/reference/cli#conformance)), and uploads the result to the release as `conformance.json`. It starts on the newest release after every successful `cut-engine-release` run, and can be started by hand from Actions with a tag, or with no tag to only reset the test repository.

It reads two secrets from the `conformance` environment: `CONFORMANCE_PAT`, a fine-grained token for the test repository, and `CONFORMANCE_FORK_PAT`, for the account that owns the fork named by the `CONFORMANCE_FORK_REPO` variable. With that variable unset, the fork preview is not tested. The environment admits only `main` and `move`, with no required reviewer. The test repository keeps its own Cloudflare and Zenodo (sandbox only) secrets.

## Pruning dev releases

Use a new `-dev.N` for each test and never move a tag. Do not deposit a real paper against a dev release, because its tag will be deleted. To delete all but the newest five dev pre-releases with their tags:

```bash
gh release list --limit 100 --json tagName,isPrerelease \
  --jq '.[] | select(.isPrerelease and (.tagName | test("-dev\\."))) | .tagName' \
  | tail -n +6 \
  | xargs -r -I{} gh release delete {} --cleanup-tag --yes
```

Stable releases are never pruned.

## Bumping typst

Edit `typst.version` and make a release ([why](https://scholar.nexus/oaktree-sapling/design/releases#r66)).

## The npm package

The package is published from a release tag by `npm-publish.yml` (Actions > npm-publish > Run workflow, with the tag): `vX.Y.Z-dev.N` goes to the `next` dist-tag, and `vX.Y.Z` goes to `latest` once its `conformance.json` says `ok`. The package version is the tag without the `v`. It uses npm trusted publishing, so there is no npm token, and runs in the `npm` environment. `prepack` runs the typecheck and the bundle first.

What ships is the `files` list in `package.json`: `dist/cli.cjs`, `templates/` (with `!templates/*/README.md` leaving out each template's README), `ci/`, `plugins/`, `paper-base.yml` and `typst.version`.
