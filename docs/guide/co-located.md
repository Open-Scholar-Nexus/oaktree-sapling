(co-located)=
# A journal with its papers in one repository

A co-located journal keeps its settings, its website and every paper in one repository. Each paper is a folder, `papers/<id>/`, named by the paper's id.

```bash
oak bootstrap journal --co-located --repo <owner>/<journal-repo> --name "My Journal" --edition 2026
```

```text
journal.yml  brand/  editions/   the journal's settings
registry/papers.yml              the papers the website lists
myst.yml  pages/  package.json   the journal website
papers/<id>/                     one folder per paper, empty to start with
.github/  CODEOWNERS             the workflows that build, check and publish each paper
```

Bootstrap sets up the branch and tag rules, the environments, the secrets you pass (the same flags as `oak bootstrap paper`) and GitHub Pages. Editing the settings and the website is as in [a journal repository](../start/journal.md).

## Who does what

Authors have no write access. An author works in a fork and sends every change as a pull request; editors review and merge. A pull request from a fork changes files in one `papers/<id>/` folder and nowhere else, or its Journal checks fail. An editor's own branches can change several papers and the settings.

A pull request from a fork that changes another author's paper still passes that rule. The checks comment names the paper each pull request changes: check that it is the author's own before merging.

(co-located-submit)=
## Submit a paper

The author runs, with their own `gh` login:

```bash
oak add-paper --repo <owner>/<journal-repo> --id smith-2026-tidal-flats
```

It checks the id against the journal's [`id_pattern`](journal-yml.md#id-pattern) and against the papers already there, forks the repository, commits the starter manuscript as `papers/smith-2026-tidal-flats/` on a branch of the fork, and opens the pull request. The edition is the year in the id, here `2026`; `--edition` names another, and the paper's `myst.yml` can change it later.

The starter manuscript shows what the editorial checks expect, and does not pass them yet.

(co-located-draft)=
## Merge it as a draft

Merging the first pull request puts the paper on `main` as a draft:

- the website does not list it, and pushes to `main` do not build it;
- its editorial checks (`checks:` in `journal.yml`) report warnings;
- its id checks block: the id's shape, the folder named by the id, no other paper with the id, and the placeholder id gone.

The merge claims the id, so a second submission with it fails. GitHub asks an editor to approve the workflow runs of an author's first pull request; once something of theirs is merged, their later pull requests run on their own, each with a preview of the paper.

(co-located-publish)=
## Publish it

To publish a paper, an editor lists it in `registry/papers.yml` on a branch of the repository:

```yaml
- id: smith-2026-tidal-flats
  location: ./papers/smith-2026-tidal-flats
```

That pull request checks every paper, and from then on the paper's editorial checks block. Once it merges, each listed paper builds in a job of its own, and the website goes up with each paper at `https://<owner>.github.io/<journal-repo>/<id>/`. A listed paper that fails to build holds back the next deployment, and the website stays as it was.

Depositing works as in [Publish a paper](publish.md), with the paper named:

- **Reserve DOI**: run the workflow with `paper` set to the id. Its pull request writes the DOI into `papers/<id>/myst.yml`.
- **Tag**: `<id>/v1.0.0` deposits that paper's version, for example `smith-2026-tidal-flats/v1.0.0`.

Each paper has its own Zenodo record.

(co-located-versions)=
## Engine versions

Each paper pins the engine in its own `myst.yml`, so a published paper keeps building with the engine it was published with. `engine_version` in `.github/actions/engine/pins.yml` is the engine the website build and the workflows that post checks and previews run. `oak upgrade --repo <owner>/<journal-repo>` moves all of them in one pull request; with `--files-only` it updates the workflows and leaves every pin.

## Credit

The layout, one folder per paper and one pull request per paper, comes from the [SciPy Proceedings](https://github.com/scipy-conference/scipy_proceedings) (MIT licence).
