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

`--site-url <url>`
: The paper's website, which the deposit links as its Project Website. Without it, oak links the `site_url` of the paper's entry in the journal's [`registry/papers.yml`](#file-registry), else the paper's GitHub Pages address. An empty value leaves the link out. [`oak release`](#release) takes it too.

(release)=
## release

`--tag <tag>`
: The version tag the deposit is for: `vX.Y.Z`, or `<paper id>/vX.Y.Z` for the paper in `papers/<paper id>/` of a [co-located journal](../guide/co-located.md). A tag naming a folder that holds no paper is refused.

(notify)=
## notify

(bootstrap)=
## bootstrap

(upgrade)=
## upgrade

(conformance)=
## conformance

(add-paper-cli)=
## add-paper

`oak add-paper --repo <owner/journal> --id <paper id> [--edition <id>]` submits a paper to a [co-located journal](../guide/co-located.md#co-located-submit): it forks the repository with your `gh` login, commits the starter manuscript as `papers/<paper id>/` on a branch of the fork, and opens the pull request. `--edition` defaults to the year in the id.

(assemble)=
## assemble

`oak assemble --builds <dir>` builds a co-located journal's website in the current directory and puts each paper `registry/papers.yml` lists at `/<paper id>/`, from its build in `<dir>/paper-build-<paper id>/`. The **Build paper** workflow runs it on every push to `main`.
