(guide-journal-settings)=
# How a paper gets the journal's settings

A paper repository names its journal on the `instance_repo:` line of `.github/actions/engine/pins.yml`, which `oak bootstrap paper --instance` writes. Every build of the paper reads the journal's settings from that repository.

## What a paper takes from the journal

`editions/<edition>.yml`
: The frontmatter shared by the paper's edition, such as the venue and the licence. The edition is the one named under `project.options.oaktree-sapling.edition` in the paper's `myst.yml`. See [editions](../reference/files.md#file-editions).

`brand/brand.yml`
: The logo, colours and the mark on the PDF. See [branding](branding.md).

`journal.yml`
: The paper id rule, the editorial checks and the PDF template. See [journal.yml](journal-yml.md) and [editorial checks](checks.md).

A field set in the paper's own `myst.yml` takes precedence over the same field from the edition.

`oak build` and `oak start` assemble the paper's settings and the journal's into `myst.oak.yml`, next to `myst.yml`, and build from it. It is rewritten on every run, gitignored, and safe to delete.

## When a change to the journal applies

In CI, every build clones the journal repository at its latest commit, so a change the editors push applies from each paper's next build.

On your machine, `oak` clones the journal into the paper's `_build/journal/<owner>/<repo>` and reuses that copy for a week, then fetches it again. If the fetch fails, for example offline, it keeps using the old copy and prints a warning. Each run prints which copy it used. To fetch the journal now, delete `_build/journal`.

## Previewing with other settings

`--instance <path>`
: Builds with the journal repository at `<path>`, for example a clone you are editing: `oak start --instance ../<journal-repo>`.

`--no-instance`
: Builds without the journal's settings: no logo, no edition frontmatter, and only oak's own checks.

Both work with `oak start`, `oak build` and `oak validate`.
