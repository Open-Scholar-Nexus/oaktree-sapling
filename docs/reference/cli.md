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

(release)=
## release

(notify)=
## notify

(bootstrap)=
## bootstrap

(upgrade)=
## upgrade

(conformance)=
## conformance
