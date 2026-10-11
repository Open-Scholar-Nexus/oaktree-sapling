(guide-journal-yml)=
# journal.yml

`journal.yml`, at the root of the journal repository, holds the settings every paper build reads. This page covers the ones a journal changes; [the reference](../reference/files.md#file-journal-yml) lists every field, and [editorial checks](checks.md) covers `checks`.

(id-pattern)=
## The paper id rule

Every paper's `project.id` has to match `id_pattern`, a regular expression. The starting pattern accepts ids such as `oak-2026-tidal-flats`:

```yaml
id_pattern: "^[a-z0-9]+-\\d{4}-[a-z0-9-]+$"
```

Keep the `^` and `$`: without them, an id only has to contain a match. Inside double quotes, a backslash is written twice.

A paper whose id does not match, or is still a placeholder, fails its Journal checks, so its pull request cannot merge. The checks comment names the id and the pattern. An id also has to be unused in the journal's [registry](add-paper.md#list-on-site).

To turn the rule off, delete the `id_pattern` line. Ids are then checked only for placeholders and duplicates, and the checks report that no pattern is set.

`id_sentinel` names one more placeholder id to reject, besides oak's own `CHANGE-ME-template-placeholder`.

(typst-template)=
## Your own PDF template

Papers are typeset with oak's own [typst](https://typst.app) template. To use another, set `typst_template` to one of:

`./<directory>`
: A MyST typst template committed in the journal repository, as a path from its root. The value has to start with `./` or `../`.

a URL
: A template zip or git repository. Pin it to a release or a commit: a template that can change while this value stays the same gets a warning in the Journal checks.

a name
: A template from MyST's [template list](https://mystmd.org/guide/creating-pdf-documents), such as `lapreprint-typst`. A name gets the same warning.

```yaml
typst_template: ./typst-template
```

A paper can set its own template in its `myst.yml` (`exports[].template`). It takes precedence over the journal's, and the Journal checks flag it for the editors.

## Zenodo community and description

Every deposit can join a [Zenodo community](https://help.zenodo.org/docs/communities/) and carry a paragraph about the journal after the abstract in its description:

```yaml
zenodo:
  community: my-journal
  description_blurb: Published in My Journal.
```

`community` is the community's identifier, the last part of its address on Zenodo. Both apply from the next [published version](publish.md).

(live-previews)=
## Live previews

Each pull request to a paper gets a preview of its website, by default as a downloadable copy of the built site. To give it a live link on Cloudflare Pages instead:

1. In Cloudflare, create a Pages project to hold the previews, and an API token allowed to edit Cloudflare Pages.
2. Set the token and the account id on each paper repository (see [Secrets](add-paper.md#paper-secrets)).
3. In `journal.yml`, set:

   ```yaml
   preview:
     provider: cloudflare
     cf_project_name: <your-pages-project>
   ```

All papers share the project, and each pull request gets its own address in it. If any of these is missing, or the deploy fails, the pull request gets the downloadable copy and the comment says why.
