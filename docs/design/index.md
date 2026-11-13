(design-index)=

# How it works

This section answers why oaktree-sapling is shaped the way it is. It is for somebody changing it, forking it, or trying to understand a decision they disagree with. If you only want to run a journal or publish a paper, start from [Run a journal](../start/setup.md) or [Write a paper](../start/paper.md); from there the guides take each setting one at a time, beginning with [Configure the journal](../guide/journal-yml.md).

## Repository layout

A journal is spread across repositories: one **journal repository** holding the settings every paper reads, and one repository **per paper**.

The journal repository holds the journal-level configuration, such as the branding and the editorial checks, and no manuscripts[^files]. Each paper repository holds one manuscript and knows almost nothing about the journal: it builds itself, checking out the engine, building the paper into a website and a PDF, and depositing it to Zenodo when a version is published.

[^files]: See [Files](../reference/files.md) for details on each.

So adding a paper means adding a repository. There is no server: each paper's own CI builds, checks and publishes it, which is why a published paper keeps building after the journal moves on. The cost is that a change to how papers build has to reach every paper repository, which is what `oak upgrade` is for.

<!-- One repository per paper is the only topology the engine builds today, and it is what this page describes. A co-located tier, where a single repository holds the journal and many papers at once, is designed but not built. It is the part of this model most likely to be revisited. -->

(processing-myst)=
## Processing MyST markdown

(design-7a)=
[MyST](https://mystmd.org) does the rendering: it converts markdown into an AST, and renders that to a website or a PDF. See [their docs](https://mystmd.org/guide) to learn more. Oaktree-sapling adds everything around a build that a single paper cannot know by itself[^around], calling MyST as a library.

(design-6)=
Most of what it adds is configuration, assembled at build time. A paper's `myst.yml` is an ordinary MyST project file, and its one engine-specific line names the engine version, under `project.options.oaktree-sapling.version`.

Everything else is worked out when the paper builds. `oak build` assembles this chain:

| | comes from | carries |
|---|---|---|
| `paper-base.yml` | oaktree-sapling | what every paper in every journal gets |
| `editions/<edition>.yml` | the journal repository | what this batch of papers gets |
| `brand/brand.yml` | the journal repository | logo, colours, the mark on the PDF |
| `myst.yml` | the paper | the manuscript's own frontmatter |

The first three rows are files outside the paper repository. In CI, before oak runs, the engine action checks out oaktree-sapling at the version the paper pinned. oak then clones the journal repository at its default branch[^pinning] into the paper's `_build/journal/`. When MyST runs (resolving the generated `extends:` chain) every entry is a local path.

[^pinning]: The journal repository is deliberately not pinned. A new logo or an extra editorial check reaches every paper on its next build, with nobody re-pinning anything. When a version is deposited to Zenodo, the journal repository at the commit its build used is archived with it, so the PDF can be rendered again with the settings it was published with ([what a deposit carries](#design-releases-deposit)).

(r71)=
The assembled result is written to **`myst.oak.yml`**[^public], next to the paper's `myst.yml`, and MyST is pointed at that file instead. It opens with a banner saying it is generated, the paper template gitignores it, and it is rewritten on every build.[^cleanup]

[How a paper's config is assembled](config.md) explains why oak generates this file, and the rules that follow from how MyST merges the chain.

## The pages here

Each page takes one part of oaktree-sapling and explains why it is built that way. What each part _does_ belongs in [Reference](../reference/files.md); this section is for the reasoning.

[How a paper's config is assembled](config.md) continues from the section above. [How a paper repository's CI is built](paper-ci.md) covers why every job is split in two, what a job holding a token is allowed to believe, and what `CODEOWNERS` gates. [The editorial checks](checks.md) covers the checks a journal writes itself, and [How oaktree-sapling is released](releases.md) why a release commits its build and what a deposit carries.

Code comments cite decisions as `[R#]` and `[design §N]`. Those not yet written up on these pages are in the original [decision record](https://github.com/pollomarzo/whitelabel/blob/v0.0.7/docs/design/record.md) and [design brief](https://github.com/pollomarzo/whitelabel/blob/v0.0.7/docs/design/brief.md), in the repository oaktree-sapling was developed in.

[^cleanup]: It is not deleted when the build ends. MyST's HTML build finishes by calling `process.exit(0)`, so anything registered to run at the end of the process never runs on a successful build. Deleting the file by hand is always safe.

[^around]: Where the journal's settings live, for one, and which version of the engine to run. Then the editorial checks, deploying a preview, reserving a DOI, and building an author's pull request without handing it a token.

[^public]: MyST builds the paper website from this file, so the project settings in the website's public JSON are the composed ones.
