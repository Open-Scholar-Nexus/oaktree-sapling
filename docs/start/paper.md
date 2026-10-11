(start-paper)=
# Your paper repository

An editor created this repository for your paper with `oak bootstrap paper`. It holds one manuscript, and its workflows build it into a website and a PDF, check it against the journal's rules, and deposit each published version on Zenodo.

## What is in it

```text
myst.yml                  the paper's metadata: id, title, authors, keywords
index.md                  the manuscript, with the abstract in its frontmatter
bib.bib                   the bibliography
thumbnails/thumbnail.png  the picture on the journal's list of papers
LICENSE                   the paper's licence, CC BY 4.0
.gitignore                keeps build output out of git
CODEOWNERS                who reviews changes to the files below
.github/                  the workflows, and the journal the paper belongs to
```

The manuscript, `myst.yml`, the bibliography and the thumbnail are yours to edit. A change to `.github/`, `CODEOWNERS` or `paper-environment.yml` needs an editor's review before it can merge. `paper-environment.yml` is optional: a conda environment, installed before each build, for a paper that runs code.

The paper is written in [MyST markdown](https://mystmd.org/guide), and `myst.yml` is an ordinary MyST project file.

## 1. Fill in myst.yml

A new repository starts from a starter paper whose `myst.yml` has placeholders. Replace them:

`project.id`
: The paper's id, unique in the journal and in the shape the journal's [`id_pattern`](../guide/journal-yml.md#id-pattern) asks for, for example `oak-2026-tidal-flats`. Until it is set, the Journal checks fail and the paper's website is not deployed.

`project.title`, `project.authors`, `project.keywords`
: The commented-out `authors` block shows the fields. The journal's [editorial checks](../guide/checks.md) decide which are required; a new journal starts by requiring an ORCID and CRediT roles for every author, an abstract, and keywords.

Write the abstract in the frontmatter of `index.md`, replace `bib.bib` with your references, and replace the grey `thumbnails/thumbnail.png`.

Leave `project.options.oaktree-sapling` as it is: it names the engine version and the journal's edition, and the build fails without them. Leave out `extends:` too; the build adds the journal's settings itself (see [below](#paper-journal-link)).

## 2. Open a pull request

Every change reaches `main` through a pull request. Unless an editor gave you push access, fork the repository and open the pull request from your fork. The first time you do, the workflows wait until an editor approves them in the repository's **Actions** tab, once per new contributor.

Each pull request gets two comments, updated on every push:

- **Journal checks**: whether the paper builds and passes the journal's checks, and what to fix when it does not. The same result shows as a check on the pull request.
- **A preview** of the paper's website: a link, or, when the journal has no live previews set up, a downloadable copy of the built site attached to the **Paper CI** run.

The pull request merges once the Journal checks pass and an editor approves it. Each merge redeploys the paper's website at `https://<owner>.github.io/<paper-repo>/`.

Once a week the repository opens an **Engine version bump** pull request of its own, moving `project.options.oaktree-sapling.version` in `myst.yml` to the newest engine release. It merges like any other once its checks pass.

## 3. Publishing a version

Editors publish. They reserve a DOI on Zenodo, which opens a pull request writing it into `myst.yml`, then create a `v*` tag. The tag builds the paper and fills the Zenodo draft, and an editor clicks **Publish** on Zenodo. Once a version is published, later pull requests carry a comment saying what an editor does on Zenodo before tagging the next one.

(paper-journal-link)=
## Where the journal's settings come from

The paper repository names its journal in `.github/actions/engine/pins.yml`, as `instance_repo: <owner>/<journal-repo>`. Every build clones that repository at its latest commit and reads from it:

- `editions/<edition>.yml`, for the edition `myst.yml` names: the venue, licence and other frontmatter every paper in the edition shares;
- `brand/brand.yml`: the logo, colours and the mark on the PDF;
- `journal.yml`: the id rule, the editorial checks and the PDF template.

A field set in your `myst.yml` takes precedence over the same field from the edition. A change the editors push to the journal repository applies from your paper's next build.

To move the paper to another edition, set `project.options.oaktree-sapling.edition` to the name of another file in the journal repository's `editions/` folder, without the `.yml`.

(paper-preview-locally)=
## Previewing locally

Install `oak` as in [Install](setup.md#install). A local build reads the journal's settings from a clone of the journal repository, the one `instance_repo` names in `.github/actions/engine/pins.yml`. Clone it beside the paper:

```bash
git clone https://github.com/<owner>/<journal-repo>.git
cd <paper-repo>
oak start --instance ../<journal-repo>
```

`oak start` serves the paper's website, prints its address, and reloads when you edit the manuscript or `myst.yml`. With `--no-instance` in place of `--instance`, it previews without the journal's settings: no logo and no edition frontmatter.

`oak build --instance ../<journal-repo>` builds the website into `_build/html` and the PDF to `_build/exports/paper.pdf`. `--exports-only` builds only the PDF, and works offline.

Both write `myst.oak.yml` beside your `myst.yml`: the configuration the build reads, assembled from yours and the journal's. It is rewritten on every run, gitignored, and safe to delete.

The PDF needs [typst](https://github.com/typst/typst) on your `PATH`, at the version in oak's [`typst.version`](src:typst.version) file. The paper's CI brings its own typst; the npm package ships none.

A local build runs the `oak` you installed, and CI runs the version `myst.yml` names. To preview with the version CI uses, install it: `npm install -g oaktree-sapling@<version>`, with the version written without its leading `v`.
