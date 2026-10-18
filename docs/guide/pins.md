(guide-pins)=
# Keeping versions current

Each paper builds with the oaktree-sapling version it names, and the journal website with the versions written into it when the journal was bootstrapped.

## A paper's engine version

A paper names its oaktree-sapling version under `project.options.oaktree-sapling.version` in its `myst.yml`. To move a paper to the newest release, run:

```bash
oak upgrade --repo <owner>/<paper-repo>
```

`oak` prints a plan, then opens a pull request that sets the version and replaces the workflows under `.github/` and `CODEOWNERS` with the release's own, keeping any code owner added to `CODEOWNERS`. A hand edit to them shows in that pull request's diff. It goes through the Journal checks and review like any other pull request, and merging it is all there is to do. Running `oak upgrade` again for the same release updates that pull request.

`--to <tag>` picks a release other than the newest, named `vX.Y.Z` or `vX.Y.Z-dev.N`. Without it, a version newer than the newest release is left as it is, and a version that is not a release tag, such as a branch, moves to the newest release. `--files-only` replaces the files and leaves the version. When the release's workflows need a newer engine than the version that pull request would set, `oak` stops before changing anything and names the oldest version they run with.

(pins-local)=
`oak start`, `oak build` and `oak validate` run the version `myst.yml` names, as the paper's CI does, and refuse the versions CI refuses: anything but a release tag. When the `oak` you installed is another version, it downloads that version into `~/.cache/oak` the first time, runs it, and says which version runs. If `.github/actions/engine/pins.yml` names an engine repository other than oaktree-sapling's own, `oak` asks before downloading from it.

(site-pins)=
## The journal website's versions

These versions in the journal repository are written at bootstrap and change only by hand:

`project.plugins` in `myst.yml`
: The `paper-cards` plugin, as a URL holding an oaktree-sapling release tag: `https://raw.githubusercontent.com/<engine-repo>/<tag>/plugins/gallery.mjs`. To update it, change the tag.

`site.template` in `myst.yml`
: The website theme, as the URL of a release zip. A release of oaktree-sapling builds papers with the theme named by `THEME_VERSION` in [`src/assets.ts`](src:src/assets.ts); use the same, so the journal website matches its papers.

`mystmd` in `package.json`
: The range of MyST versions the website builds with. Each build installs the newest version in the range.

Push the change, and the **Journal site** workflow builds with the new versions. If that build fails, the website keeps serving the last version deployed; revert the change to build again.
