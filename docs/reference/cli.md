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
: Reserves a draft on Zenodo, writes its DOI into `myst.yml`, and opens the pull request for it with gh. Production by default; `--sandbox` uses the Zenodo sandbox. `--repo <owner/name>` names the repository; without it, `GITHUB_REPOSITORY` or the clone's origin does. In GitHub Actions with no token it fails, pointing at running it from the terminal.

`oak deposit upload --pdf <path> --tag <vX.Y.Z>`
: Fills the draft with the files and metadata, calling Zenodo only. The committed DOI picks the sandbox or production. [`oak release`](#release) runs it, with the build and the GitHub steps around it.

`oak deposit status`
: The deposit's state for the committed DOI, and the metadata an upload would send. `--sandbox` reads the sandbox.

`--site-url <url>`
: The paper's website, which the deposit links as its Project Website. Without it, oak links the `site_url` of the paper's entry in the journal's [`registry/papers.yml`](#file-registry), else the paper's GitHub Pages address. An empty value leaves the link out. [`oak release`](#release) takes it too.

(release)=
## release

`oak release --tag <vX.Y.Z>` deposits the tag's build on Zenodo, attaches the deposit's files to the tag's GitHub release, and comments the draft's address on the tagged commit. The committed DOI picks the sandbox or production.

In GitHub Actions, the **Deposit version** workflow runs it with `--no-build` on the build its first job made. When Zenodo refuses, it opens an issue labelled `zenodo-publish-failed`. With no token for the DOI's environment, it deposits nothing and ends successfully with a notice to run it from the terminal.

Outside GitHub Actions the clone has to be at the tag, with no changes to tracked files. By default the build is the `release-build` artifact of the tag's **Deposit version** run, downloaded with gh once its build job has passed, whatever the deposit job did. The run has to be a run of `.github/workflows/deposit-version.yml` that the push of that tag started, at the tag's commit. The provenance records when its build job finished as the build time.

`--local-build`
: Builds on this computer and deposits that build, after a warning: the build runs the paper's code beside the Zenodo token ([building on your computer](#local-build)). The provenance records the platform and the typst that ran.

`--no-build`
: Deposits the build already under `_build/`.

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
