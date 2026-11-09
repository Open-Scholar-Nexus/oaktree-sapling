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

`oak release [--repo <owner/name>] <vX.Y.Z>` publishes a version from the terminal ([guide](#from-terminal)). It has three subcommands, [`reserve-doi`](#release-reserve-doi), [`deposit`](#release-deposit) and [`status`](#release-status); the paper's workflows run the first two.

It works in a clone of the repository in a temporary folder, and acts on GitHub as the editor's gh login. Without `--repo`, the repository is the `origin` of the git clone in the current folder. The temporary clone is removed when the release is done. After a failure or Ctrl-C it is kept, and oak prints its path.

Each run does what is not done yet, so running it again after a stop continues:

- `main` has no DOI: runs `oak release reserve-doi`, merges the DOI pull request, and tags the merge commit.
- `main` has a DOI and the tag does not exist: tags the head of `main`.
- The tag exists: uses it, and asks nothing.

Then it waits for the tag's **Deposit version** run and runs `oak release deposit` with the clone at the tag. When the tag's GitHub release already holds the deposit files, it deposits nothing and ends.

Before merging the DOI pull request, it marks the pull request's Journal checks as skipped. It merges only the commit `reserve-doi` pushed (`gh pr merge --match-head-commit`), with a merge commit, or a squash when the repository allows no merge commits. A pull request left open by an earlier run gets a new commit, which is the one merged.

It prints a line, starting with the time, for each step it completes, and ends with what is left to do. While it waits, a terminal shows a spinner with what it waits for; elsewhere it prints the run's state when it changes. The subcommands' own output is shown when one fails, and live with `--verbose`. It waits up to 10 minutes for the run to start and 45 for it to finish. It also waits for the run's publish job, when there is one, so that it never deposits at the same time as CI.

The subcommands run with the `oak` version the paper pins ([which version runs](#pins-local)), read at the commit each works on: `main` for `reserve-doi`, the tag for `deposit`.

Before changing anything, it lists what it will do and asks to confirm; `--yes` skips the question, except the one about another engine repository ([which version runs](#pins-local)). `--sandbox` reserves the DOI on the Zenodo sandbox. Without a version, it lists the repository's `v*` tags.

It refuses, before changing anything:

- a word after `release` that is neither a version nor a subcommand;
- `--tag` and `--use-local-build`, which belong to `oak release deposit`;
- a repository whose `myst.yml` names no oak version;
- a pinned version older than `DEPOSIT_MIN_VERSION`, the first whose subcommands never build beside the Zenodo token ([why](#design-paper-ci-deposit-min));
- `--sandbox` once a production DOI is committed;
- an existing tag whose `myst.yml` holds no DOI;
- a new tag when the newest version on Zenodo is published with another version, since **New version** was not clicked;
- running in GitHub Actions, where the workflows run the subcommands.

It exits 0 when done or when a rerun finds nothing left, 2 when it refuses or a subcommand fails, and 3 when a wait reached its limit. After a 3, running the same command again continues.

The token for the subcommands comes from `--token`, else `ZENODO_TOKEN`, or `ZENODO_TOKEN_SANDBOX` for the sandbox; a sandbox run never uses the production one.

What `--repo <owner/name>` does depends on the command. `oak release vX` and `oak release status` clone that repository into a temporary folder and work there. `oak release reserve-doi` and `oak release deposit` work in the clone they run in, and take `--repo` as its name on GitHub.

(release-status)=
`oak release status`
: For the committed DOI, the newest version published on Zenodo and the draft of the next one, if any. `--json` adds the metadata a deposit would send. `--sandbox` reads the sandbox. `--repo <owner/name>` reads the repository's default branch from a clone in a temporary folder, removed after, with the editor's gh login.

(release-reserve-doi)=
### oak release reserve-doi

`oak release reserve-doi` reserves a draft on Zenodo, writes its DOI into `myst.yml`, and opens the pull request for it with gh. The **Reserve DOI** workflow runs it, and `oak release` runs it when publishing the first version. With gh logged out it says to commit the change and open the pull request yourself. Production by default; `--sandbox` uses the Zenodo sandbox. `--repo <owner/name>` names the repository; without it, `GITHUB_REPOSITORY` or the clone's origin does. In GitHub Actions with no token it fails, pointing at `oak release` from the terminal.

`--site-url <url>`
: The paper's website, which the deposit links as its Project Website. Without it, oak links the `site_url` of the paper's entry in the journal's [`registry/papers.yml`](#file-registry), else the paper's GitHub Pages address. An empty value leaves the link out. `oak release`, `oak release deposit` and `oak release status` take it too.

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

(clean)=
## clean

`oak clean` lists the folders [`oak release`](#release) left in the temporary folder, such as the clones it keeps after a failure or Ctrl-C, with their size, and removes them after you confirm. It looks in the temporary folder of the shell it runs in (`TMPDIR`), and prints its path. It lists only folders whose name starts with `oak-release-` and that belong to you, and never a symlink. It cannot tell whether an `oak release` is still using a clone, so run it when none is running. A successful `oak release` removes the clones kept for the same repository and version, since a clone's folder name holds both.

It also shows the size of `~/.cache/oak` (`$XDG_CACHE_HOME/oak` when set), which holds the `oak` versions papers pin ([which version runs](#pins-local)). `--cache` removes it too; the next command that needs a version fetches it again.

`--yes` skips the confirmation prompt, and is needed without a terminal; declining removes nothing, so answering no only lists them. `--json` prints what it found and removed.

(bootstrap)=
## bootstrap

(upgrade)=
## upgrade

(conformance)=
## conformance
