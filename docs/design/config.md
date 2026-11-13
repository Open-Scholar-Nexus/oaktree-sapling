(design-config)=

# How a paper's config is assembled

A paper builds from `myst.oak.yml`, a file oak writes next to the paper's `myst.yml` ([the chain it holds](#processing-myst)). The paper's own config is the base of that file. `paper-base.yml`, the journal's edition and the journal's brand are its `extends:` layers. What oak sets itself, such as the PDF template, it writes into the base.

Each rule on this page follows from how MyST merges a config with the layers it extends.

## How MyST merges an `extends:` chain

- **The base wins.** For a key that the base and a layer both set, MyST keeps the base's value.
- **Most keys are replaced whole.** `exports` entries are matched by `id`, and the config that wins an `id` supplies the entire entry. `site.options` and `project.options` are the exceptions: MyST merges them key by key.
- **The layers have no order.** MyST loads the `extends:` entries in parallel, so when two layers set the same key, which one wins can change between runs.

(r52)=
## Why oak generates the file

oak sets values on things a paper may declare too. A paper with several articles declares its own PDF export, and oak still has to set `template:` and `output:` on it. From a layer it could not: the paper's export would win the `id` and replace the layer's entry whole. So oak writes its values into the base, and the base has to be a file oak owns, because the paper's `myst.yml` is read and never written ([](#r71)).

The paper's config is copied into that base, where it wins over every layer. As one more `extends:` entry it would load in parallel with the edition and the brand.

oak writes the file in two steps. The first holds the paper's config and the `extends:` chain, and MyST loads it to resolve the project. The second adds oak's values to the base. For the PDF export that is the complete entry: the one MyST resolved, from `paper-base.yml` or from the paper, with oak's `template:` and `output:` set on it.

(r72)=
## The layers set different keys

`paper-base.yml`, the edition and the brand each set keys the other two leave alone, because a key that two layers set has no stable winner. `oak validate` reports a key that two layers share as an error.

## Values oak reads from the file that sets them

Once MyST has merged the chain, a value no longer says which file it came from. Where that matters, oak reads the value from its own file.

(r62)=
**Paths in the brand.** A path in `brand/brand.yml`, such as `logo` or `favicon`, is relative to the journal repository, and MyST resolves it against the paper. oak reads these fields from `brand/brand.yml` and makes a relative path absolute under the journal repository. A relative path in the paper's own config is left alone.

(r76)=
**The PDF template.** oak uses the first template that is set, in this order:

1. `--typst-template` on the command line
2. `template:` on the PDF export in the paper's `myst.yml`
3. `typst_template:` in `journal.yml`
4. oak's own, in `templates/typst`

The journal's template is a field in `journal.yml` because an `exports:` entry in the edition would share a key with `paper-base.yml`. A paper's own template is used, and `oak validate` warns about it on the pull request, where an editor decides. A deposit archives a template that is not oak's as `template.zip` ([what a deposit carries](#design-releases-deposit)).

(r82)=
## What `oak validate` checks

`oak validate` writes `myst.oak.yml` as `oak build` does and runs the checks on it. Some of what it checks, such as the cover image and the PDF export, is set by `paper-base.yml` and is absent from the paper's `myst.yml`.

With `--no-instance`, or when the journal repository cannot be found, there are no layers to add. `oak validate` then checks the paper's `myst.yml` and says so in a note on the Check Run.
