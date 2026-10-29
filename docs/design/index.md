(design-index)=

# How it works

This section answers why oaktree-sapling is shaped the way it is. It is for somebody changing it, forking it, or trying to understand a decision they disagree with. If you only want to run a journal or publish a paper, start from [Run a journal](../start/setup.md) or [Write a paper](../start/paper.md); from there the guides take each setting one at a time, beginning with [Configure the journal](../guide/journal-yml.md).

Nothing here is required reading; if you want to know more, start with this page.

## Repository layout

A journal is spread across repositories: one **journal repository** holding the settings every paper reads, and one repository **per paper**.

The journal repository holds the journal-level configuration, such as the branding and the editorial checks, and no manuscripts[^files]. Each paper repository holds one manuscript and knows almost nothing about the journal: it builds itself, checking out the engine, building the paper into a website and a PDF, and depositing it to Zenodo when a version is published.

[^files]: See [Files](../reference/files.md) for details on each.

So adding a paper means adding a repository. There is no server: each paper's own CI does the work, which is why a published paper keeps building after the journal moves on. The cost is that a change to how papers build has to reach every paper repository, which is what `oak upgrade` is for.

<!-- One repository per paper is the only topology the engine builds today, and it is what this page describes. A co-located tier, where a single repository holds the journal and many papers at once, is designed but not built. It is the part of this model most likely to be revisited. -->

(processing-myst)=
## Processing MyST markdown

(design-7a)=
[MyST](https://mystmd.org) does the rendering: it converts markdown into an AST, and is able to render that to a website or a PDF. See [their docs](https://mystmd.org/guide) to learn more. Oaktree-sapling adds everything around a build that a single paper cannot know by itself[^around], calling MyST as a library.

(design-6)=
Most of what it adds is configuration, assembled at build time. A paper's `myst.yml` is an ordinary MyST project file, and its one engine-specific line names the engine version, under `project.options.oaktree-sapling.version`.

Everything else is worked out when the paper builds. `oak build` assembles this chain:

| | comes from | carries |
|---|---|---|
| `paper-base.yml` | oaktree-sapling | what every paper in every journal gets |
| `editions/<edition>.yml` | the journal repository | what this batch of papers gets |
| `brand/brand.yml` | the journal repository | logo, colours, the mark on the PDF |
| `myst.yml` | the paper | the manuscript's own frontmatter |

Both external repositories are fetched before the engine runs: oaktree-sapling at the version the paper pinned, the journal repository at its default branch[^pinning]. When MyST runs (resolving the generated `extend` chain) every entry is a local path.

[^pinning]: The journal repository is deliberately not pinned. A new logo or an extra editorial check reaches every paper on its next build, with nobody re-pinning anything. When a version is deposited to Zenodo, the journal repository at the commit its build used is archived with it, so the PDF can be rendered again with the settings it was published with ([what a deposit carries](#design-releases-deposit)).

(r71)=
The assembled result is written to **`myst.oak.yml`**[^public], next to the paper's `myst.yml`, and MyST is pointed at that file instead[^compose]. It opens with a banner saying it is generated, the paper template gitignores it, and it is rewritten on every build.[^cleanup]

(r208)=
## The journal's own checks

A journal lists its [own checks](../guide/checks.md#journal-checks) under `checks` in `journal.yml`, which authors cannot change, each by the path of a JavaScript file in the journal repository. A paper's MyST `error_rules` and plugins cannot be the gate, because the author controls them.

The path is the check's id. No catalog id starts with `./`, so a path cannot collide with a Curvenote check, and the report's row names the file that produced it. The resolved path has to stay inside the journal repository: in CI the journal is cloned into the paper's checkout, at `_build/journal/<owner>/<name>`, so a path leaving it reaches files the author controls. Only `.mjs` files load, because Node reads a `.js` file as CommonJS or as an ES module depending on a `package.json` the journal repository may not have.

A check file is shaped like a Curvenote check: its `validate` takes the entry's options and returns Curvenote's results, so a check moves between the two with only its reads of the paper rewritten. Its first argument is plain data, `paper`, and two helper functions, where a Curvenote check gets a MyST session. It loads from the journal clone, where no packages are installed, so it cannot import myst-cli, and myst-cli does not run unbundled on Node 24 anyway. `paper` is built once per run, in the module that imports myst-cli, and each check gets its own copy of the trees.

The journal repository is not pinned[^pinning], so one check file runs under every oak version the journal's papers pin. `paper` therefore only gains fields, as `journal.yml` does: a check reading a field an older oak lacks gets `undefined`. A paper pinned to an oak older than check files reports the path as an unknown check id.

Every check's `validate` runs inside a `try`, Curvenote's included, so a check that throws becomes one error row under its id and the other checks still run.

## The pages here

Each page takes one part (slice?) of oaktree-sapling and explains why it is built that way. What each part _does_ belongs in [Reference](../reference/files.md); this section is for the reasoning.

[How a paper repository's CI is built](paper-ci.md) is the first of them: why every job is split in two, what a job holding a token is allowed to believe, and what `CODEOWNERS` gates.

Code comments cite decisions as `[R#]` and `[design §N]`. Those not yet written up on these pages are in the original [decision record](https://github.com/pollomarzo/whitelabel/blob/v0.0.7/docs/design/record.md) and [design brief](https://github.com/pollomarzo/whitelabel/blob/v0.0.7/docs/design/brief.md), in the repository oaktree-sapling was developed in.

[^cleanup]: It is not deleted when the build ends. MyST's HTML build finishes by calling `process.exit(0)`, so anything registered to run at the end of the process never runs on a successful build. Deleting the file by hand is always safe.

[^around]: Where the journal's settings live, for one, and which version of the engine to run. Then the editorial checks, deploying a preview, reserving a DOI, and building an author's pull request without handing it a token.

[^compose]: Why generate a file, rather than add an `extends:` line to the paper's config? We need control over how the chain resolves. In plain MyST the paper's own config wins over everything it extends, and entries like PDF export definitions are merged whole rather than field by field, so an extended layer cannot adjust one field of something the paper declares. An engine that needs to override any default behaviour therefore cannot express itself as a layer.

[^public]: MyST builds the paper website from this file, so the project settings in the website's public JSON are the composed ones.
