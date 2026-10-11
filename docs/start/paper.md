(start-paper)=
# Your paper repository

An editor has created a repository for your paper. You write the paper there in [MyST markdown](https://mystmd.org/guide), and its workflows turn it into a website and a PDF in the journal's style.

The steps below get you from that repository to a preview on your own machine, then to a pull request the editors can merge.

## Before you start

You need a GitHub account, `git`, and Node 22 or later. Then install `oak`:

```bash
npm install -g oaktree-sapling
```

## 1. Fork and clone

On the paper repository's GitHub page, click **Fork**. Then clone your fork, and the journal's repository beside it:

```bash
git clone https://github.com/<you>/<paper-repo>.git
git clone https://github.com/<owner>/<journal-repo>.git
```

The journal's repository holds the logo, colours and settings every paper in the journal is built with. It is public, so anyone can clone it. Its name is on the `instance_repo:` line of `.github/actions/engine/pins.yml` in the paper repository.

If an editor gave you push access to the paper repository, clone it directly and skip the fork.

(paper-preview-locally)=
## 2. Preview it

```bash
cd <paper-repo>
oak start --instance ../<journal-repo>
```

Open the address `oak start` prints. The preview reloads as you edit.

`--instance` is the path to your clone of the journal. With `--no-instance` in its place, the preview skips the journal's settings: no logo, no venue on the paper.

## 3. Write the paper

`myst.yml`
: The paper's metadata. Replace the placeholders: `id`, unique in the journal and in the shape the journal asks for (for example `oak-2026-tidal-flats`, see [id_pattern](../guide/journal-yml.md#id-pattern)), then `title`, `authors` and `keywords`. The commented-out `authors` block shows the fields. Leave the `oaktree-sapling` block at the bottom as it is.

`index.md`
: The paper, with its abstract in the frontmatter at the top.

`bib.bib`
: Your references, cited as `[@key]`.

`thumbnails/thumbnail.png`
: The picture shown beside your paper on the journal's website.

The journal's [editorial checks](../guide/checks.md) decide which metadata is required. A new journal starts by requiring an ORCID and CRediT roles for every author, an abstract, and keywords.

## 4. Open a pull request

Commit, push to your fork, and open a pull request against the paper repository. The first time you do, its workflows wait until an editor approves them.

Each pull request then gets two comments, updated on every push:

- **Journal checks**: whether the paper builds and passes the journal's checks, and what to fix when it does not.
- **A preview** of the paper's website, as a link or as a download attached to the **Paper CI** run.

Once the checks pass and an editor approves, the pull request can merge, and the paper's website at `https://<owner>.github.io/<paper-repo>/` updates. Changes to `.github/`, `CODEOWNERS` or `paper-environment.yml` need an editor's review on top.

## 5. Publication

Editors publish a version: they reserve a DOI on Zenodo, which opens a pull request writing it into `myst.yml`, then tag the version, and the paper is deposited on Zenodo.

Once a week the repository also opens an **Engine version bump** pull request, which updates the version in `myst.yml`. It merges like any other once its checks pass.

(paper-journal-link)=
## Where the journal's settings come from

`.github/actions/engine/pins.yml` names the journal's repository. Every build, in CI and with `oak start --instance`, reads three things from it:

- `editions/<edition>.yml`, for the edition named in `myst.yml`: the venue, licence and other frontmatter shared by the edition;
- `brand/brand.yml`: the logo, colours and the mark on the PDF;
- `journal.yml`: the id rule, the editorial checks and the PDF template.

A field set in your `myst.yml` takes precedence over the same field from the edition. CI reads the journal's latest commit, so a change the editors make applies from your paper's next build; `git pull` in your clone to preview with it.

## Building the PDF locally

```bash
oak build --instance ../<journal-repo>
```

This writes the website to `_build/html` and the PDF to `_build/exports/paper.pdf`; `--exports-only` builds only the PDF. The PDF needs [typst](https://github.com/typst/typst) on your `PATH`, at the version in oak's [`typst.version`](src:typst.version) file.

`oak start` and `oak build` also write `myst.oak.yml` next to `myst.yml`: your settings and the journal's, assembled. It is gitignored and safe to delete.

A local build uses the `oak` you installed; CI uses the version in `myst.yml`. To match CI, install that version: `npm install -g oaktree-sapling@<version>`, without the leading `v`.
