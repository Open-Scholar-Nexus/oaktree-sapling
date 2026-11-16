(guide-journal-yml)=
# Configure the journal

`journal.yml`, at the root of the journal repository, holds the settings every paper build reads. This page covers the ones most journals change; [the reference](../reference/files.md#file-journal-yml) lists every field, and [editorial checks](checks.md) covers `checks`. The logo, colours and favicon are set in `brand/brand.yml`: see [branding](branding.md).

(id-pattern)=
## The paper id rule

Every paper's `project.id` has to match `id_pattern`, a regular expression. The starting pattern accepts ids such as `oak-2026-tidal-flats`:

```yaml
id_pattern: "^[a-z0-9]+-\\d{4}-[a-z0-9-]+$"
```

Keep the `^` and `$`: without them, an id only has to contain a match. Inside double quotes, a backslash is written twice.

A paper whose id does not match, or is still a placeholder, fails its Journal checks, so its pull request cannot merge. The checks comment names the id and the pattern. An id also has to be unused in the journal's [registry](publish.md#list-on-site).

To turn the rule off, delete the `id_pattern` line. Ids are then checked only for placeholders and duplicates, and the checks report that no pattern is set.

`id_sentinel` names one more placeholder id to reject, besides oak's own `CHANGE-ME-template-placeholder`.

(typst-template)=
## Your own PDF template

Papers are typeset with oak's own [typst](https://typst.app) template. To use another, set `typst_template` to one of:

`./<directory>`
: A MyST typst template committed in the journal repository, as a path from its root. The value has to start with `./` or `../`.

a URL
: A template `.zip`, pinned to a commit or a release, such as `https://github.com/<owner>/<repo>/archive/<sha>.zip`.[^floating]

a name
: A template from MyST's [template list](https://mystmd.org/guide/creating-pdf-documents), such as `lapreprint-typst`.[^floating]

[^floating]: A template that can change while this value stays the same gets a warning in the Journal checks: a template name, a branch's zip, or a git repository URL ending in `.git`, which myst fetches at its `main` branch.

```yaml
typst_template: ./typst-template
```

A paper can set its own template in its `myst.yml` (`exports[].template`). It takes precedence over the journal's, and the Journal checks flag it for the editors.

(zenodo-community)=
## Zenodo community, description and links

A paper can join a [Zenodo community](https://help.zenodo.org/docs/communities/), and the journal can add to every deposit's description a paragraph about the journal, after the abstract, and links to addresses the paper sets in its `myst.yml`:

```yaml
zenodo:
  community: my-journal
  description_blurb: Published in My Journal.
  links:
    - option: youtube
      label: Seminar recording
      text: Watch on YouTube
      relation: isSupplementedBy
```

`community` is the community's identifier, the last part of its address on Zenodo. It applies to a paper whose first version is not published yet: an editor submits that draft to the community ([publish on Zenodo](publish.md#publish-on-zenodo)), and later versions stay in the community. A paper published before the community was set, or with [`--publish-without-review`](publish.md#publish-without-review), joins it only when an editor submits its record to the community on Zenodo.

The paragraph and the links apply from the next [published version](publish.md).

(zenodo-links)=
Each entry in `links` reads the web address a paper sets as `project.options.<option>` in its `myst.yml`, and adds a line `<label>: <text>` to the description, with `<text>` linking to that address. With this example, a paper that sets

```yaml
project:
  options:
    youtube: https://youtu.be/<video>
```

gets the line **Seminar recording: Watch on YouTube**. `relation` is optional: it also lists the address among the record's related works, with that relation (the [`zenodo.links` reference](../reference/files.md#file-journal-yml) lists the values). A paper that sets no such option gets no line. A value that is not an `http` or `https` address gets no line either, and the deposit prints a warning. A journal's PDF template can read the same option to show the link in the PDF; oak uses it only for the Zenodo description.

(live-previews)=
## Live previews

Each pull request to a paper gets a preview of its website, by default as a downloadable copy of the built site. To give it a live link on Cloudflare Pages instead:

1. In Cloudflare, create a Pages project to hold the previews, and an API token allowed to edit Cloudflare Pages.
2. Set the token and the account id on each paper repository (see [Secrets](../reference/secrets.md)).
3. In `journal.yml`, set:

   ```yaml
   preview:
     provider: cloudflare
     cf_project_name: <your-pages-project>
   ```

All papers share the project, and each pull request gets its own address in it. If any of these is missing, or the deploy fails, the pull request gets the downloadable copy and the comment says why.
