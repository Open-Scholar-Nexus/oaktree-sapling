(design-config)=

# How a paper's config is assembled

(r52)=
oaktree-sapling gives every paper the settings its journal controls and the engine version the paper pins. MyST combines config files through `extends:`: a `myst.yml` lists other files there, and its own values win over theirs. That suits settings fixed in a file, but many of oak's values are known only when the paper builds: where the engine and the journal were cloned, which version the paper pins, and whether a PDF exists yet for the website to offer. So on every build oak writes `myst.oak.yml` next to the paper's `myst.yml`, with (1) the paper's config, (2) oak's values for that run, and (3) `paper-base.yml` and the journal's files under `extends:`, and MyST builds from it.

In CI, for a paper in the `seedling` edition of the journal `acme/journal`, `myst.oak.yml` looks like this (shortened):

::::{scroll-code}
```{code-block} yaml
:filename: myst.oak.yml
:linenos:
version: 1
project:
  id: my-paper
  title: My paper
  authors:
    - name:
        given: Ada
        family: Lovelace
  options:
    oaktree-sapling:
      version: v0.4.0
      edition: seedling
    logo: .../_build/journal/acme/journal/brand/watermark.svg
  exports:
    - format: typst
      id: typst-pdf
      articles:
        - file: index.md
          level: 0
      output: _build/exports/paper.pdf
      template: .../.engine/templates/typst
  downloads:
    - id: typst-pdf
      title: PDF export
extends:
  - .../.engine/paper-base.yml
  - .../_build/journal/acme/journal/editions/seedling.yml
  - .../_build/journal/acme/journal/brand/brand.yml
site:
  template: https://github.com/jupyter-book/myst-theme/.../book-theme.zip
  options:
    logo: .../_build/journal/acme/journal/brand/logo.svg
    favicon: .../_build/journal/acme/journal/brand/favicon.svg
```

:::{scroll-step} 23-26
Lines 23 to 26 list oak's `paper-base.yml` and the journal's files; [Processing MyST markdown](#processing-myst) says what each one sets.
:::

:::{scroll-step} 1-10
Lines 1 to 10 are the paper's own `myst.yml`.
:::

:::{scroll-step} 11-22, 27-31
oak adds the rest.
:::
::::

Writing its values into the file also lets oak set fields on an entry the paper declares. For a key that a `myst.yml` and a listed file both set, the value in the `myst.yml` replaces the other whole[^options]. A paper with several articles declares its own PDF export, which would replace an export oak set from a listed file, so oak sets `template:` and `output:` on the paper's export in `myst.oak.yml` itself.

[^options]: `site.options` and `project.options` are the exception: MyST merges them key by key.

oak writes the file in two steps. The first version contains the paper's config and the `extends:` list, and MyST loads it to resolve the project. oak then adds its own values. For the PDF export, oak writes the whole entry MyST resolved, from `paper-base.yml` or from the paper, with its own `template:` and `output:` set on it.

(r82)=
`oak validate` writes `myst.oak.yml` as `oak build` does and checks that file, so it also checks what the paper's `myst.yml` leaves to `paper-base.yml`, such as the cover image and the PDF export.

(r72)=
MyST loads the files under `extends:` in parallel, so when two of them set the same key, either value can end up in the build. Each key is set in one of [`paper-base.yml`](src:paper-base.yml), the [edition file](#file-editions) and the [brand file](#file-brand-yml), and `oak validate` reports a key set in two of them as an error. The paper's config is in `myst.oak.yml` itself, so for a key it shares with one of the three files, MyST uses the paper's value.

(r62)=
## Paths in the brand

A path in `brand/brand.yml`, such as `logo` or `favicon`, starts at the journal repository's root, and MyST resolves it against the paper. oak reads these fields from `brand/brand.yml` and writes them into `myst.oak.yml` as absolute paths under the journal repository, as on lines 11, 30 and 31. A relative path in the paper's own `myst.yml` stays as it is.

(r76)=
## The PDF template

oak uses the first template that is set, in this order:

1. `--typst-template` on the command line
2. `template:` on the PDF export in the paper's `myst.yml`
3. `typst_template:` in `journal.yml`
4. oak's own, in `templates/typst`

The journal's template is a field in `journal.yml` because an `exports:` entry in the edition would share a key with `paper-base.yml`. A paper's own template is used, and `oak validate` warns about it on the pull request, where an editor decides. A deposit archives a template that is not oak's as `template.zip` ([what a deposit contains](#design-releases-deposit)).
