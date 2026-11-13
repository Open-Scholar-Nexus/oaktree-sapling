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

(r72)=
MyST loads the `extends:` entries in parallel, so when two of them set the same key, which one wins can change between runs. So `paper-base.yml`, the edition and the brand set different keys, and `oak validate` reports a key two of them share.

(r62)=
MyST resolves a brand's asset paths, such as `logo` and `favicon`, against the paper, where the journal's files are not. So oak reads them from `brand/brand.yml` itself and makes a relative one absolute under the journal repository. A paper's own relative path is left alone.

In CI the engine action checks out oaktree-sapling at the version the paper pinned before oak runs, and oak clones the journal repository at its default branch[^pinning] into the paper's `_build/journal/`. When MyST runs (resolving the generated `extends:` chain) every entry is a local path.

[^pinning]: The journal repository is deliberately not pinned. A new logo or an extra editorial check reaches every paper on its next build, with nobody re-pinning anything. When a version is deposited to Zenodo, the journal repository at the commit its build used is archived with it, so the PDF can be rendered again with the settings it was published with ([what a deposit carries](#design-releases-deposit)).

(r71)=
The assembled result is written to **`myst.oak.yml`**[^public], next to the paper's `myst.yml`, and MyST is pointed at that file instead. It opens with a banner saying it is generated, the paper template gitignores it, and it is rewritten on every build.[^cleanup]

(r52)=
The paper's own config is the base of `myst.oak.yml`, and the chain is its `extends:`. MyST lets the base win over everything it extends, and merges `exports` by id, whole: the config that wins an id supplies the complete entry. An extended layer therefore cannot change one field of an export, so oak writes its additions into the base, and its PDF export is complete: the resolved entry (`paper-base.yml`'s, or the paper's own) plus the `template:` and `output:` oak sets.

(r76)=
oak takes the first PDF template that is set, in this order: `--typst-template`, the author's own `exports[].template`, `typst_template:` in `journal.yml`, and oak's own `templates/typst`. The journal's template is a field in `journal.yml` because a second layer declaring `exports:` would share a key with `paper-base.yml`. An author's template is used, and `oak validate` warns about it on the pull request, where an editor decides. A deposit archives a template that is not oak's as `template.zip` ([what a deposit carries](#design-releases-deposit)).

(r82)=
`oak validate` writes and reads the same `myst.oak.yml` as `oak build`, so the checks judge the config that is published. With no journal to compose, it checks the author's `myst.yml` and says so in a note on the Check Run.

## The pages here

Each page takes one part of oaktree-sapling and explains why it is built that way. What each part _does_ belongs in [Reference](../reference/files.md); this section is for the reasoning.

[How a paper repository's CI is built](paper-ci.md) is the first of them: why every job is split in two, what a job holding a token is allowed to believe, and what `CODEOWNERS` gates. [The editorial checks](checks.md) covers the checks a journal writes itself, and [How oaktree-sapling is released](releases.md) why a release commits its build and what a deposit carries.

Code comments cite decisions as `[R#]` and `[design §N]`. Those not yet written up on these pages are in the original [decision record](https://github.com/pollomarzo/whitelabel/blob/v0.0.7/docs/design/record.md) and [design brief](https://github.com/pollomarzo/whitelabel/blob/v0.0.7/docs/design/brief.md), in the repository oaktree-sapling was developed in.

[^cleanup]: It is not deleted when the build ends. MyST's HTML build finishes by calling `process.exit(0)`, so anything registered to run at the end of the process never runs on a successful build. Deleting the file by hand is always safe.

[^around]: Where the journal's settings live, for one, and which version of the engine to run. Then the editorial checks, deploying a preview, reserving a DOI, and building an author's pull request without handing it a token.

[^public]: MyST builds the paper website from this file, so the project settings in the website's public JSON are the composed ones.
