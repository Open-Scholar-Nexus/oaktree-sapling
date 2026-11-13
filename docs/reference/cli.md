(ref-cli)=
# CLI reference

`oak --help` lists every command and its flags. This page says what each one does.

(cli-any-command)=
## Any command

`--help`
: Prints the list of commands. `oak help` and `-h` do the same.

`--version`
: Prints the version of `oak`.

`--json`
: Prints the full result as JSON on stdout. Everything else `oak` prints goes to stderr.

`--verbose`
: Shows the output of the git and gh commands as they run. A failed command shows its output either way.

`--yes`
: Answers yes to the plan a command shows before changing anything. Without a terminal, a command that asks needs it.

A flag that takes a value and is given none stops the command. This usually means an empty shell variable.

`OAK_USE_RUNNING=1` runs the installed `oak`, without downloading the version a paper names. It is for developing `oak` itself.

(build)=
## build

`oak build` builds the paper's website and PDF into `_build/`. It first writes `myst.oak.yml`, the paper's settings combined with the journal's, and builds from it. It runs the `oak` version the paper names ([which version runs](#pins-local)). In a journal repository it refuses: the journal website is built by its own workflow.

`--paper <dir>`
: The paper's folder. Defaults to the current folder.

`--instance <dir>`, `--no-instance`
: Build with the journal repository at `<dir>`, or without the journal's settings. See [previewing with other settings](../guide/journal-settings.md#previewing-with-other-settings).

`--base-url <url>`
: The path the website is served under, such as `/my-paper`. Defaults to the root. The paper's workflows set it for GitHub Pages.

`--no-site-template`
: Builds the website with MyST's default theme.

`--exports-only`
: Builds the PDF and not the website, so it does not download the website's theme.

`--no-exports`
: Builds the website and not the PDF.

`--typst-template <dir>`
: Renders the PDF with the typst template in `<dir>`, ahead of the author's, the journal's and oak's own. [`oak start`](#start) and [`oak validate`](#validate) take it too, so all three write the same `myst.oak.yml`.

(start)=
## start

`oak start` runs MyST's live preview of the paper, with the journal's settings, and prints its address. It writes `myst.oak.yml` as [`oak build`](#build) does, and writes it again when `myst.yml` changes. The preview offers the PDF for download once `oak build` has made one. Ctrl-C stops it.

In a journal repository, it serves the journal website as it is. Run `npm install` there first.

It takes `--paper`, `--instance`, `--no-instance`, `--base-url` and `--typst-template`, as [`oak build`](#build) does.

`--port <n>`, `--server-port <n>`, `--template <path>`, `--headless`, `--keep-host`
: Passed to MyST's own `myst start`, which takes options of the same names.

(validate)=
## validate

`oak validate` runs oak's own checks and the journal's [editorial checks](../guide/checks.md) on the paper, and prints what fails. It writes `myst.oak.yml` as [`oak build`](#build) does, and checks that. It runs the paper's plugin code ([read this first](../guide/checks.md#validate-runs-paper-code)).

It exits 0 when nothing blocks the merge, 1 when a check fails, and 2 when it cannot run.

It takes `--paper`, `--instance`, `--no-instance` and `--typst-template`, as [`oak build`](#build) does.

`--strict`
: Warnings fail too.

`--report <path>`
: Writes the full result as JSON to `<path>`, for [`oak post-checks`](#post-checks). It then exits 0 once the file is written, whether the checks passed or not. The **Check paper** workflow uses it.

`--repo <owner/name>`
: The paper's repository on GitHub, used to find its entry in the journal's [`registry/papers.yml`](files.md#file-registry). Without it, `GITHUB_REPOSITORY` or the clone's `origin` names it.

(post-checks)=
## post-checks

`oak post-checks` posts the result `oak validate --report` wrote. The **Post checks** workflow runs it, after each **Check paper** run. It never runs the checks again.

It posts the result on the checked commit as the **Journal checks** Check Run and commit status, and as a comment on the pull request. The comment is updated on every push. Before posting, it checks that the pull request's head is still the commit that was checked.

When the pull request changes a file listed in `CODEOWNERS`, the Check Run and the comment say so. That change can alter how the checks run, so an editor should read it. The result itself stays the same.

It exits 1 when the Check Run could not be posted. A comment that could not be posted only gives a warning.

`--report <path>`, `--repo <owner/name>`, `--sha <commit>`, `--base <branch>`, `--verified-head <commit>`
: The report, the repository, the commit checked, the branch the pull request targets, and the head commit GitHub reports for the run. All are required, except `--repo` when `GITHUB_REPOSITORY` is set. Posting needs `GH_TOKEN`.

`--paper <dir>`
: The paper's folder, when the report does not name it.

(deploy-preview)=
## deploy-preview

`oak deploy-preview [<site>]` posts a preview of a pull request's website. The **Deploy preview** workflow runs it, after each **Build paper** run, with the built site in the folder `<site>` (default `site`).

It reads the pull request's number from a file the build left in the site, and removes that file. A site with no number gets no preview. Before posting, it checks that the pull request's head is still the commit that was built. It also removes the files Cloudflare Pages would run as code or use to rewrite pages, such as `_worker.js` and `_headers`, with a warning.

With `preview.provider: cloudflare` and `preview.cf_project_name` in [`journal.yml`](files.md#file-journal-yml), and both Cloudflare secrets set, it deploys the site to Cloudflare Pages and comments the preview's address on the pull request. Otherwise the comment links the build's artifact and says why. A failed Cloudflare deploy or an unreadable `journal.yml` also gives the artifact link. The comment is updated on every push.

It fails only when the pull request's head is another commit, or when gh cannot post the comment.

`--verified-head <commit>`
: The commit that was built. Defaults to the head commit of the run that started the workflow.

`--repo <owner/name>`
: The repository. Defaults to `GITHUB_REPOSITORY`.

`--paper <dir>`, `--instance <dir>`, `--no-instance`
: As for [`oak build`](#build).

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

It prints a line, starting with the time, for each step it completes, and ends with what is left to do. While it waits, a terminal shows a spinner with what it waits for; elsewhere it prints the run's state when it changes. The subcommands' own output is shown when one fails; `--verbose` shows it as they run. It waits up to 10 minutes for the run to start and 45 for it to finish. It also waits for the run's publish job, when there is one, so that it never deposits at the same time as CI.

The subcommands run with the `oak` version the paper pins ([which version runs](#pins-local)), read at the commit each works on: `main` for `reserve-doi`, the tag for `deposit`.

Before changing anything, it lists what it will do and asks to confirm; `--yes` skips the question, except when the paper uses a different engine repository ([which version runs](#pins-local)). `--sandbox` reserves the DOI on the Zenodo sandbox. Without a version, it lists the repository's `v*` tags.

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
: Outside GitHub Actions, deposits the build under `_build/` in place of the **Deposit version** run's, after a warning. The run's build is the recommended one. oak cannot check that this build was made from the tag: it only refuses one whose PDF or pages are older than the tag's commit, as a build left from an earlier tag is. The build is the editor's own, made at the tag with `oak build` in a shell without the Zenodo token, since it runs the paper's code with the editor's permissions: the plugins `myst.yml` lists ([read them first](../guide/checks.md#validate-runs-paper-code)), and any environment `paper-environment.yml` describes, which the editor sets up. The provenance records this computer's platform and the typst on `PATH`; the engine's typst is built for Linux on x86_64, so elsewhere the PDF comes from the system typst and can differ from the CI build.

`--publish-without-review`
: Publishes the draft once it is filled, with no check on Zenodo first. `oak release` takes it too.

`--token <token>`
: The Zenodo token, ahead of `ZENODO_TOKEN` and `ZENODO_TOKEN_SANDBOX`. Every `oak release` command takes it.

`--bundle-out <dir>`
: Where the deposit's files are written. Defaults to `_build/bundle`.

`--paper <dir>`, `--myst <path>`
: The paper's folder, or its `myst.yml`, for the subcommands. Default: `./myst.yml`.

`--instance <dir>`, `--no-instance`
: As for [`oak build`](#build). `oak release` passes them on to its subcommands.

(clean)=
## clean

`oak clean` lists the folders [`oak release`](#release) left in the temporary folder, such as the clones it keeps after a failure or Ctrl-C, with their size, and removes them after you confirm. It looks in the temporary folder of the shell it runs in (`TMPDIR`), and prints its path. It lists only folders whose name starts with `oak-release-` and that belong to you, and never a symlink. It cannot tell whether an `oak release` is still using a clone, so run it when none is running. A successful `oak release` removes the clones kept for the same repository and version, since a clone's folder name holds both.

It also shows the size of `~/.cache/oak` (`$XDG_CACHE_HOME/oak` when set), which holds the `oak` versions papers pin ([which version runs](#pins-local)). `--cache` removes it too; the next command that needs a version fetches it again.

`--yes` skips the confirmation prompt, and is needed without a terminal; declining removes nothing, so answering no only lists them. `--json` prints what it found and removed.

(bootstrap)=
## bootstrap

`oak bootstrap journal` creates a journal repository, and `oak bootstrap paper` a paper repository, on GitHub, from the templates in `oak`. Both print a plan, with every default they took, and ask before changing anything. Running the same command again finishes a run that stopped partway. Files already on `main` are left as they are. How to use them: [Create a journal](../start/setup.md) and [Add a paper](../guide/add-paper.md).

Each template file is copied, except for these values, which bootstrap fills in:

- In a paper repository: the engine version and the edition, under `project.options.oaktree-sapling` in `myst.yml`; the repository's address, as `project.github`; the engine repository and the journal repository, in `.github/actions/engine/pins.yml`; the owner, in `CODEOWNERS`.
- In a journal repository: the journal's name, in `journal.yml`, the brand's `logo_text`, the edition's `venue`, the website's title and the heading of `pages/index.md`; the website's address, as the brand's `logo_url`; the edition, as the name of the edition file.
- In the journal website: the address of the `paper-cards` plugin at the engine version, the theme, and the range of MyST versions in `package.json`. See [the journal website's versions](../guide/pins.md#site-pins).

Bootstrap also sets up the repository on GitHub: [what it sets up](../guide/add-paper.md#what-it-sets-up).

`--repo <owner/name>`
: The repository to create. Required.

`--engine-version <tag>`
: The `oak` release the repository uses. Defaults to the installed `oak`, which has to be a stable release. Another version is downloaded into `~/.cache/oak` once, and that version runs the bootstrap.

`--engine-repo <owner/name>`
: Where `oak` is downloaded from. Defaults to `Open-Scholar-Nexus/oaktree-sapling`.

For `oak bootstrap journal`:

`--name <name>`
: The journal's name. Defaults to a placeholder, `Acorn Annals`.

`--edition <id>`
: The first edition. Defaults to `seedling`.

`--no-site`
: Leaves out the journal website and its workflow.

`--co-located`
: Not ready yet. Meant to put the journal and its paper in one repository.

For `oak bootstrap paper`:

`--instance <owner/name>`
: The journal repository. Required.

`--edition <id>`
: One of the journal's editions, named by a file in its `editions/` folder. Required.

`--from <url>`, `--source-ref <ref>`
: Imports the author's repository at `<url>`, at the branch or tag `<ref>` (default `main`), as a pull request.

`--owner <@user|@org/team>`
: Who owns the repository's workflows and settings in `CODEOWNERS`. Defaults to you.

`--private`
: Makes the repository private.

`--no-require-checks`
: Leaves the Journal checks out of the branch rule on `main`.

`--zenodo-token <token>`, `--zenodo-token-sandbox <token>`
: Set as the secrets `ZENODO_TOKEN` and `ZENODO_TOKEN_SANDBOX` on the `zenodo-prepare` and `zenodo-publish` environments.

`--cf-token <token>`, `--cf-account <id>`
: Set as the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on the `preview` environment.

Without a token flag, bootstrap uses the environment variable with the secret's name, if set. Only `oak bootstrap paper` takes the token flags: `oak bootstrap journal` refuses them, since the journal repository publishes nothing. Once an environment holds a secret, bootstrap deletes a repository-level copy of it, which every branch could read. At the end, it lists the secrets still missing. What each token allows: [Secrets](secrets.md).

(upgrade)=
## upgrade

`oak upgrade` moves a paper repository to a newer `oak` release, through a pull request. A paper keeps the version its `myst.yml` names until an editor runs `oak upgrade`. A new release of `oak` never reaches a paper by itself. A change to the journal repository does: each paper reads it on its next run ([when](../guide/journal-settings.md)).

It fills in the release's `.github/` folder and `CODEOWNERS` with the repository's own values from `pins.yml` and `CODEOWNERS`, and compares them with the repository's files. It then opens a pull request that sets the version in `myst.yml` and replaces each file that differs. Code owners added to `CODEOWNERS` are kept. A file under `.github/` that the release no longer has is listed, and left in place.

The pull request goes through the Journal checks and an editor's review like any other. When nothing differs, it opens none. Running it again for the same release updates the open pull request. How to use it: [Keeping versions current](../guide/pins.md).

`--repo <owner/name>`, `--paper <dir>`
: The paper repository: on GitHub, worked on in a clone in a temporary folder, or a clone on this computer. One of the two is required.

`--to <tag>`
: The release to move to. Defaults to the newest stable release.

`--files-only`
: Replaces the files and leaves the version in `myst.yml`.

(conformance)=
## conformance

`oak conformance` tests a release of `oak` on GitHub, with a paper repository kept for testing. The engine's **Conformance** workflow runs it after each release. [RELEASING.md](src:RELEASING.md) covers the workflow.

`oak conformance run --repo <owner/name> --tag <vX.Y.Z>`
: Moves the test repository to the release with `oak upgrade`, then checks each path its CI takes: the build and GitHub Pages, the editorial checks, a preview from a branch, the Zenodo deposit and, with a fork, a preview from the fork. It exits 0 when all pass, 1 when one fails, 3 when GitHub, Cloudflare or Zenodo did not finish in time, and 4 when the test repository already uses the release, so nothing was tested.

`--fork-repo <owner/name>`
: The fork to open the fork pull request from, else `CONFORMANCE_FORK_REPO`. The fork preview runs only when `CONFORMANCE_FORK_PAT` holds a token for the fork's owner.

`--run-id <id>`
: Names the branches the run creates, `cert-<id>`. Defaults to the current time.

`--record <path>`
: Writes the result as JSON to `<path>`. The workflow uploads it to the release as `conformance.json`.

`oak conformance reset --repo <owner/name>`
: Removes the branches, pull requests and tags earlier runs left in the test repository. Running it twice does no harm.
