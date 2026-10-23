(guide-journal-settings)=
# Journal settings in a paper

A paper repository names its journal on the [`instance_repo:` line](src:templates/paper/.github/actions/engine/pins.yml#L7) of `.github/actions/engine/pins.yml`, which `oak bootstrap paper --instance` writes:

```yaml
instance_repo: <owner>/<journal-repo>
```

Every build of the paper reads the journal's settings from that repository.

## What a paper takes from the journal

`editions/<edition>.yml`
: The frontmatter shared by the paper's edition, such as the venue and the licence. The edition is the one named under `project.options.oaktree-sapling.edition` in the paper's `myst.yml`. See [editions](../reference/files.md#file-editions).

`brand/brand.yml`
: The logo, colours and the mark on the PDF. See [branding](branding.md).

`journal.yml`
: The paper id rule, the editorial checks and the PDF template. See [Configure the journal](journal-yml.md) and [editorial checks](checks.md).

A field set in the paper's own `myst.yml` takes precedence over the same field from the edition.

`oak build` and `oak start` assemble the paper's settings and the journal's into `myst.oak.yml`, next to `myst.yml`, and build from it. It is rewritten on every run, gitignored, and safe to delete.

## When a change to the journal applies

In CI, every run that reads the journal clones the journal repository at its latest commit, so a change the editors push applies from each paper's next run.

On your machine, `oak` keeps a cached clone of the journal in the paper's `_build/journal/<owner>/<repo>` and reuses it for a week, then fetches it again. If the fetch fails, for example offline, it keeps using the cache and prints a warning. Each run prints which copy it used. To clear the cache and fetch the journal now, delete `_build/journal`.

(previewing-with-other-settings)=
## Previewing with other settings

`--instance <path>`
: Builds with the journal repository at `<path>`, for example a clone you are editing: `oak start --instance ../<journal-repo>`.

`--no-instance`
: Builds without the journal's settings: no logo, no edition frontmatter, and only oak's own checks.

Both work with every command that reads the journal's settings, such as `oak start` and `oak build`.
