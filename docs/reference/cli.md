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

(deposit)=
## deposit

The Zenodo verbs. The **Reserve DOI** workflow runs `oak deposit prepare`, and an editor can run them all from a clone of the paper repository ([publishing from the terminal](#from-terminal)). The token comes from `--token`, else `ZENODO_TOKEN`, or `ZENODO_TOKEN_SANDBOX` for the sandbox; a sandbox run never uses the production one.

`oak deposit prepare`
: Reserves a draft on Zenodo, writes its DOI into `myst.yml`, and opens the pull request for it with gh. With gh logged out it says to commit the change and open the pull request yourself. Production by default; `--sandbox` uses the Zenodo sandbox. `--repo <owner/name>` names the repository; without it, `GITHUB_REPOSITORY` or the clone's origin does. In GitHub Actions with no token it fails, pointing at running it from the terminal.

`oak deposit upload --pdf <path> --tag <vX.Y.Z>`
: Fills the draft with the files and metadata, calling Zenodo only. The committed DOI picks the sandbox or production. [`oak release`](#release) runs it, with the build and the GitHub steps around it.

`oak deposit status`
: The deposit's state for the committed DOI, and the metadata an upload would send. `--sandbox` reads the sandbox.

`--site-url <url>`
: The paper's website, which the deposit links as its Project Website. Without it, oak links the `site_url` of the paper's entry in the journal's [`registry/papers.yml`](#file-registry), else the paper's GitHub Pages address. An empty value leaves the link out. [`oak release`](#release) takes it too.

(release)=
## release

`oak release --tag <vX.Y.Z>` deposits the tag's build on Zenodo, attaches the deposit's files to the tag's GitHub release, and comments the draft's address on the tagged commit. The committed DOI picks the sandbox or production. The deposit's files are written to `_build/bundle` (`--bundle-out <dir>`). Like `deposit`, it refuses a pinned version too old to deposit from the terminal ([which version runs](#pins-local)).

In GitHub Actions, it deposits the build under `_build/`, which the **Deposit version** workflow's first job made. When Zenodo refuses, it opens an issue labelled `zenodo-publish-failed`. With no token for the DOI's environment, it deposits nothing and ends successfully with a notice to run it from the terminal.

Outside GitHub Actions the clone has to be at the tag, with no changes to tracked files. By default the build is the `release-build` artifact of the tag's **Deposit version** run, downloaded with gh once its build job has passed, whatever the deposit job did. The run has to be a run of `.github/workflows/deposit-version.yml` that the push of that tag started, at the tag's commit, and the artifact has to hold `myst.oak.yml`, `_build/exports` and `_build/site/content`. The provenance records when its build job finished as the build time. It refuses while the build job runs, when it failed, and when the run has no build job or its artifact lacks one of those paths.

(use-local-build)=
`--use-local-build`
: Outside GitHub Actions, deposits the build under `_build/` after a warning, refusing one whose PDF or pages are older than the tag's commit, as a build left from an earlier tag is. The build is the editor's own, made at the tag with `oak build` in a shell without the Zenodo token, since it runs the paper's code with the editor's permissions: the plugins `myst.yml` lists ([read them first](../guide/checks.md#validate-runs-paper-code)), and any environment `paper-environment.yml` describes, which the editor sets up. The provenance records this computer's platform and the typst on `PATH`; the engine's typst is built for Linux on x86_64, so elsewhere the PDF comes from the system typst and can differ from the CI build.

`--publish-without-review`
: Publishes the draft once it is filled, with no check on Zenodo first.

`--token <token>`
: The Zenodo token, ahead of `ZENODO_TOKEN` and `ZENODO_TOKEN_SANDBOX`.

(notify)=
## notify

(bootstrap)=
## bootstrap

(upgrade)=
## upgrade

(conformance)=
## conformance
