(start-paper)=
# Your paper repository

An editor has created a repository for your paper. You write the paper there in [MyST markdown](https://mystmd.org/guide), and its workflows turn it into a website and a PDF in the journal's style, using oaktree-sapling.

The steps below get you from that repository to a preview on your own machine, then to a pull request the editors can merge.

## Before you start

You need a GitHub account, `git`, and Node 22 or later. Then install `oak`, oaktree-sapling's command-line tool:

```bash
npm install -g oaktree-sapling
```

## 1. Fork and clone

If an editor gave you push access to the paper repository, clone it directly and skip the fork. Otherwise, on the paper repository's GitHub page, click **Fork**, then clone your fork:

```bash
git clone https://github.com/<you>/<paper-repo>.git
```

(paper-preview-locally)=
## 2. Preview it

```bash
cd <paper-repo>
oak start
```

(paper-journal-link)=
Open the address `oak start` prints. The preview reloads as you edit, and shows the paper in the journal's style.[^settings]

## 3. Write the paper

`myst.yml`
: The paper's metadata. Replace the placeholders: `id`, unique in the journal and in the shape the journal asks for (for example `oak-2026-tidal-flats`, see [id_pattern](../guide/journal-yml.md#id-pattern)), then `title`, `authors` and `keywords`. The commented-out `authors` block shows the fields. Leave the `oaktree-sapling` block at the bottom as it is.

`index.md`
: The paper, with its abstract in the frontmatter at the top. The [MyST guide](https://mystmd.org/guide) covers the syntax: headings, figures, equations, citations.

`bib.bib`
: Your references, cited as `[@key]`.

`thumbnails/thumbnail.png`
: The picture shown beside your paper on the journal's website.

The journal's [editorial checks](../guide/checks.md) decide which of these are required.

## 4. Open a pull request

Commit, push to your fork, and open a pull request against the paper repository. The first time you do, its workflows wait until an editor approves them.

A bot then comments on the pull request with the result of the journal's checks, including anything to fix, and a preview of the paper's website. It updates the comments on every push.

Once the checks pass and an editor approves, the pull request can merge, and the paper's website at `https://<owner>.github.io/<paper-repo>/` updates.

Once a week the bot also opens a pull request updating the oaktree-sapling version in `myst.yml`, which goes through the same checks and review.

## Building the PDF

```bash
oak build
```

This writes the PDF to `_build/exports/paper.pdf`. It needs [typst](https://github.com/typst/typst) installed.

[^settings]: The journal's logo, colours, edition and checks live in the journal's own repository, which the editors maintain and your paper repository names. Your paper's builds read them from there. [How a paper gets the journal's settings](../guide/journal-settings.md) has the details.
