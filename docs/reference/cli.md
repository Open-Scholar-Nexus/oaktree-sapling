(ref-cli)=
# CLI reference

*Work in progress.*

(deploy-preview)=
## deploy-preview

(build)=
## build

`oak build` builds the paper's website and PDF into `_build/`.

`--exports-only`
: Builds the PDF and not the website, so it does not download the website's theme.

`--no-exports`
: Builds the website and not the PDF.

`--typst-template <dir>`
: Renders the PDF with the typst template in `<dir>`, ahead of the author's, the journal's and oak's own. [`oak start`](#start) and [`oak validate`](#validate) take it too, so all three write the same `myst.oak.yml`.

(start)=
## start

Takes `--typst-template <dir>`, as [`oak build`](#build) does.

(validate)=
## validate

Takes `--typst-template <dir>`, as [`oak build`](#build) does.

(post-checks)=
## post-checks

(release)=
## release

`oak release [--repo <owner/name>] <vX.Y.Z>` publishes a version from the terminal ([guide](#from-terminal)). It acts on GitHub as the editor's gh login, in a clone of the repository (if you omit `--repo`, it will attempt to use the current clone's origin) in a temporary folder, removed when the release is done and kept, with its path printed, after a failure or Ctrl-C. Each run picks its steps from what already exists, so running it again after a stop continues:

- if `main` has no DOI: runs [`oak release reserve-doi`](#release-reserve-doi), marks the DOI pull request's Journal checks as skipped, and merges it at the commit that run pushed (`gh pr merge --match-head-commit`), with a merge commit, or a squash when the repository allows no merge commits. Then it tags the merge commit. A pull request left open by an earlier run gets a new commit, which is the one merged.
- if `main` has a DOI and the tag does not exist: tags the head of `main` as shown in the confirmation. It refuses when the newest version on Zenodo is published with another version, since **New version** was not clicked.
- The tag exists: uses it as it is, once its `myst.yml` holds a DOI, and asks nothing.

Then it waits for the tag's **Deposit version** run: its build job, and its publish job when there is one, to avoid clashing with a concurrent CI deposit. It prints a line when a state changes and every 5 minutes; it waits 10 minutes for the run to start and 45 for it to finish. When the tag's GitHub release already holds the deposit files, it ends there. Otherwise it runs [`oak release deposit`](#release-deposit) with the clone at the tag. The steps run with the `oak` version the paper pins at the commit they work on ([which version runs](#pins-local)): `main` for the DOI, the tag for the deposit. It refuses a pinned version older than `DEPOSIT_MIN_VERSION`, the first with these steps that never builds beside the Zenodo token ([why](#design-paper-ci-deposit-min)), before it tags or changes anything.

It asks once, up front, listing the steps left; `--yes` skips the confirmation prompt. `--sandbox` reserves the DOI on the sandbox, and is refused once a production DOI is committed. Without a version it lists the repository's `v*` tags. A word after `release` that is neither a version nor a step is refused, and so are `--tag` and `--use-local-build`, which belong to `oak release deposit`. It refuses in GitHub Actions, where the workflows run its steps. It exits 0 when done and when a rerun finds nothing left, 2 when it refuses or a step fails, and 3 when a wait reached its limit: running the same command again continues.

The token for the steps comes from `--token`, else `ZENODO_TOKEN`, or `ZENODO_TOKEN_SANDBOX` for the sandbox; a sandbox run never uses the production one.

(release-status)=
`oak release status`
: The deposit's state for the committed DOI, and the metadata a deposit would send. `--sandbox` reads the sandbox.

(release-reserve-doi)=
### oak release reserve-doi

`oak release reserve-doi` reserves a draft on Zenodo, writes its DOI into `myst.yml`, and opens the pull request for it with gh. The **Reserve DOI** workflow runs it, and `oak release` runs it when publishing the first version. With gh logged out it says to commit the change and open the pull request yourself. Production by default; `--sandbox` uses the Zenodo sandbox. `--repo <owner/name>` names the repository; without it, `GITHUB_REPOSITORY` or the clone's origin does. In GitHub Actions with no token it fails, pointing at `oak release` from the terminal.

`--site-url <url>`
: The paper's website, which the deposit links as its Project Website. Without it, oak links the `site_url` of the paper's entry in the journal's [`registry/papers.yml`](#file-registry), else the paper's GitHub Pages address. An empty value leaves the link out. `oak release` and `oak release deposit` take it too.

(release-deposit)=
### oak release deposit

`oak release deposit --tag <vX.Y.Z>` deposits the tag's build on Zenodo, in the clone at `--paper` (default `.`), attaches the deposit's files to the tag's GitHub release, and comments the draft's address on the tagged commit. The **Deposit version** workflow runs it, `oak release` runs it, and an editor can run it by hand. The committed DOI picks the sandbox or production. The deposit's files are written to `_build/bundle` (`--bundle-out <dir>`). It never tags or merges.

In GitHub Actions, it deposits the build under `_build/`, which the **Deposit version** workflow's first job made. When Zenodo refuses, it opens an issue labelled `zenodo-publish-failed`. With no token for the DOI's environment, it deposits nothing and ends successfully with a notice to run `oak release` from the terminal.

Outside GitHub Actions the clone has to be at the tag, with no changes to tracked files. By default the build is the `release-build` artifact of the tag's **Deposit version** run, downloaded with gh once its build job has passed, whatever the deposit job did. The run has to be a run of `.github/workflows/deposit-version.yml` that the push of that tag started, at the tag's commit, and the artifact has to hold `myst.oak.yml`, `_build/exports` and `_build/site/content`. The provenance records when its build job finished as the build time. It refuses while the build job runs, when it failed, and when the run has no build job or its artifact lacks one of those paths.

(use-local-build)=
`--use-local-build`
: An escape hatch, not the recommended path. Outside GitHub Actions, it deposits the build under `_build/` instead of the Deposit version run's, after a warning. oak cannot check that this build was made from the tag: it only refuses one whose PDF or pages are older than the tag's commit, as a build left from an earlier tag is. The build is the editor's own, made at the tag with `oak build` in a shell without the Zenodo token, since it runs the paper's code with the editor's permissions: the plugins `myst.yml` lists ([read them first](../guide/checks.md#validate-runs-paper-code)), and any environment `paper-environment.yml` describes, which the editor sets up. The provenance records this computer's platform and the typst on `PATH`; the engine's typst is built for Linux on x86_64, so elsewhere the PDF comes from the system typst and can differ from the CI build.

`--publish-without-review`
: Publishes the draft once it is filled, with no check on Zenodo first. `oak release` takes it too.

`--token <token>`
: The Zenodo token, ahead of `ZENODO_TOKEN` and `ZENODO_TOKEN_SANDBOX`. Every `oak release` command takes it.

(bootstrap)=
## bootstrap

(upgrade)=
## upgrade

(conformance)=
## conformance
