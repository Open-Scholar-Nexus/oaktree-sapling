(design-releases)=

# How oaktree-sapling is released

A paper's CI runs oak from a checkout of the engine repository at the version the paper pins, and installs nothing. This page covers why the build is committed at the release tag, what else is committed there, and the risks the release process accepts. The steps for making a release are in [`RELEASING.md`](src:RELEASING.md).

(r57)=

## Why commit the build with a tag

[`ci/run.sh`](src:ci/run.sh) ends with `exec node "$engine/dist/cli.cjs"`, so the build has to be in the checkout before a paper can run it. The [release script](src:scripts/cut-engine-release.sh) commits `dist/cli.cjs` and `bin/typst` to a new commit off HEAD and tags that commit. It then makes a GitHub release on the tag, which `releases/latest` and `oak upgrade` read. Both are gitignored, so no branch carries them, and a paper that pins a branch stops in `ci/run.sh` with an error telling it to pin a release tag.

Committing the build at the tag gives three things. Starting oak in a paper's CI takes one git checkout and no install. Local runs and CI read the same committed file, so they match by git object rather than by esbuild being reproducible. And the Zenodo deposit's `engine.zip`, a `git archive` of that checkout, carries typst, so a deposited PDF can be rendered again with nothing fetched.

The cost is that a branch cannot run in CI: every ref a paper can run is one a release made[^constraint].

[^constraint]: So every paper build runs code that passed the release script's tests, under a version name that always means the same build.

These were considered and rejected:

- Publishing to npm and installing it in CI. An npm version cannot be deleted after 72 hours, so every dev release made to test CI would stay published, and neither typst nor `engine.zip` works from a package (see [](#design-releases-npm)).
- Committing the build to `main` on every commit puts a build artifact in the history people read.
- Having CI commit the build back forces a `git pull` after every push.
- Force-pushed `*-built` refs are standing machinery for a rare need.
- Release assets downloaded after checkout are a second download on every run, and they are outside the git tree, so `git archive` leaves them out of `engine.zip`.
- Git LFS adds a dependency to every consumer.

(r66)=

## What is committed with the build

A deposited PDF is rendered again with oak from `engine.zip` ([below](#design-releases-deposit)), so everything oak needs for it has to be in git at the tag. The PDF template already is, under `templates/typst`. Typst is a binary from its own GitHub releases, so the release script commits it as `bin/typst`. The web theme is downloaded at build time, because a deposit carries the PDF and not the website.

The release script downloads typst at the version in `typst.version` and runs the tests with it, so the binary that ships is the one the tests used. Bumping typst means editing `typst.version` and making a release, and it reaches a paper through the same version pin as any other change to oak.

`bin/typst` is built for linux x86_64 (musl) only, which is what CI uses: every workflow in this repository and in the paper templates runs on `ubuntu-latest`. So a deposited PDF renders again with nothing fetched on that platform only. On macOS or arm64 the PDF export uses the system typst[^exec].

[^exec]: A Linux binary keeps its executable bit on macOS, so `ci/run.sh` runs `bin/typst --version` before putting it on `PATH`. Checking `-x` alone would put a binary that fails with `Exec format error` ahead of a working one.

(design-releases-deposit)=

## What a deposit carries

A deposit holds the PDF and what it was rendered from. To render the PDF again with nothing fetched from GitHub, unzip `engine.zip`, `journal.zip` and `source.zip` into three folders, and from the paper's folder run:

```sh
node <engine>/dist/cli.cjs build --instance <journal> --exports-only
```

When the deposit has a `template.zip`, unzip it too and add `--typst-template <template>`. [`--exports-only`](#build) builds the PDF without the website, whose theme is downloaded. For a paper that is its own journal[^own-journal], leave out `--instance`: oak finds `journal.yml` beside the paper.

| file | holds |
|---|---|
| `paper.pdf` | the PDF |
| `source.zip` | the paper repository at the tagged commit |
| `myst.yml` | the paper's own config |
| `myst.oak.yml` | the config the build assembled, kept as a record: its paths are the build machine's |
| `engine.zip` | oak at the version the paper pins, with typst and oak's PDF template |
| `journal.zip` | the journal repository at the commit the build used |
| `template.zip` | the PDF template, when it is the journal's or the author's |
| `publication-provenance.json` | the paper's and the journal's repository and commit, the paper's website, the DOIs, and the typst version |

The files in the paper's `deposit/` folder are added beside them, and these names are reserved.

`journal.zip` holds the journal commit the build used, which the build records in `myst.oak.yml` under `project.options.oaktree-sapling.journal`. The deposit runs in a job of its own and fetches that commit, so the archive matches the PDF even when the journal has changed since the build, as when a failed deposit job is re-run, or an editor deposits [from the terminal](#from-terminal), days later. The record's Zenodo metadata follows the journal's `zenodo:` settings as they are when the deposit runs. A build from journal files that are not a commit of their own repository, such as local changes, cannot be deposited.

A paper repository that is its own journal (`instance_repo: "."` in `pins.yml`)[^own-journal] gets no `journal.zip`, because its journal files are in `source.zip` at the same commit; the provenance names the paper's repository and commit as the journal's. A paper built with `--no-instance` has no journal to archive.

[^own-journal]: Planned, in development.

(r114)=

## A stable release is `latest` before it is tested

A stable `vX.Y.Z` enters `releases/latest` as soon as it is released, and `latest` is what `oak upgrade` resolves when no version is given. `oak bootstrap` pins the running `oak`'s version and names the npm package's `latest` in its plan when it is newer, and npm gets a release only once conformance passed on it. Conformance runs after the release, so a journal can pick up a release that has not passed it, and a release that fails stays `latest` until someone deletes it or makes a newer one.

## Conformance runs on releases

(r111)=
A conformance run goes through several real CI runs on the test paper repository, so it tests releases rather than pull requests and is not a required check. It uses a personal access token because `GITHUB_TOKEN` does not reach another repository, and events it causes start no workflows. A run where a third party timed out exits 3 and stays green, so a red run points at oak rather than at GitHub, Cloudflare or Zenodo being slow. A run on a release the test repository already pins has no upgrade to test: it exits 4, stays green and uploads nothing, so the release keeps the `conformance.json` that `npm-publish` checks before publishing a stable tag.

## Dev releases

The release script refuses a tag that already exists, pre-releases included, because a paper pinned to a moved tag would run a different build under the same name. So each dev release gets a new number, and old ones are deleted in batches, tag included. A paper deposited against one keeps its `engine.zip` on Zenodo, but the version it names no longer exists.

(design-releases-npm)=

## The npm package

The npm package is a second way to get oak, and papers do not use it: their CI runs oak from a checkout, as above.

`npm-publish.yml` publishes a stable release tag with npm trusted publishing, once its `conformance.json` says `ok`, and sets the package version to the tag. It refuses a dev tag: npm versions stay published for good once the 72 hour unpublish window closes, and a dev tag is deleted when pruned.

`repository` in `package.json` has to name the repository whose Actions run publishes, because provenance checks it. The workflow sets it to the repository it runs in.

`files` in `package.json` is an allowlist. It carries what the CLI reads at runtime, plus all of `ci/` and `plugins/`: papers use those from the checkout and from a pinned raw URL, but they are small, and shipping them keeps the tarball a subset of the checkout. `prepack` runs the typecheck and the bundle. `dist/` is gitignored, and `npm pack` leaves out a missing file without an error, so the bundle has to be built by a hook that runs on both `npm pack` and `npm publish`, which `prepublishOnly` does not.

`oak bootstrap` and `upgrade` run from the package. `validate`, `build` and `start` run the version the paper pins, from a clone of its tag when the package is another version ([](#design-paper-ci-local-ref)), and so does `bootstrap --engine-version` naming another version. `release` and `deposit` always run from a clone of the pinned tag, and the workflow commands from a checkout of it, which carries two things the tarball leaves out:

- `bin/typst`, built for linux x86_64 only. A build run from the package exports the PDF with the typst on the system, and one handed to a clone uses the clone's when it runs.
- The git history `oak release` and `oak deposit` need: they make `engine.zip` with `git archive` over the engine directory, and `node_modules/oaktree-sapling` is not a git repository.
