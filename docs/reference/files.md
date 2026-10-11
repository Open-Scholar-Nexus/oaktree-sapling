(ref-files)=
# Files in a journal repository

*Work in progress.*

(file-journal-yml)=
## journal.yml

The journal's settings, read by every paper build. Every field but `name` is optional, and oak ignores fields it does not know. How to use them: [journal.yml](../guide/journal-yml.md).

| field | default | |
|---|---|---|
| `name` | | The journal's name. Required. `oak bootstrap journal --name` also writes it to the brand's `logo_text`, the edition's `venue` and the website's title, which are what the papers show. |
| `url` | | The journal's address, for people reading the file. |
| `tier` | `paper` | Only `paper` is built. |
| `id_sentinel` | | An id rejected as a placeholder, besides `CHANGE-ME-template-placeholder`. |
| `id_pattern` | | A regular expression every paper's `project.id` must match, when set. See [the paper id rule](../guide/journal-yml.md#id-pattern). |
| `typst_template` | oak's template | The PDF template: a `./` or `../` path in the journal repository, a URL, or a MyST template name. See [your own PDF template](../guide/journal-yml.md#typst-template). |
| `preview.provider` | `artifact` | `cloudflare` for live previews on Cloudflare Pages, `artifact` for a downloadable copy. See [live previews](../guide/journal-yml.md#live-previews). |
| `preview.cf_project_name` | | The Cloudflare Pages project the previews go to. |
| `preview.branch_pattern` | `paper-{repo}-{pr}` | The name of each preview inside the project, with `{repo}` and `{pr}` filled in. It is lowercased and cut to 28 characters, shortening `{repo}` first. |
| `zenodo.community` | | The Zenodo community every deposit joins. |
| `zenodo.description_blurb` | | A paragraph added to every deposit's description, after the abstract. |
| `checks` | none | The editorial checks, one `id` each, plus `optional: true` and the check's own options. See [editorial checks](../guide/checks.md). |

(file-brand-yml)=
## brand/brand.yml

(file-editions)=
## editions/&lt;edition&gt;.yml

(file-registry)=
## registry/papers.yml

(file-pages-index)=
## pages/index.md

(file-site-workflow)=
## .github/workflows/site.yml
