(ref-files)=
# Files in a journal repository

*Work in progress.*

(file-journal-yml)=
## journal.yml

The journal's settings, read by every paper build. Every field but `name` is optional, and oak ignores fields it does not know. How to use them: [Configure the journal](../guide/journal-yml.md).

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
| `preview.branch_pattern` | `paper-{repo}-{pr}` | The name of each preview inside the project, with `{repo}` and `{pr}` filled in. It is lowercased and cut to 28 characters by shortening `{repo}`, which then ends in a 4-character hash so that papers with similar names stay distinct. |
| `zenodo.community` | | The Zenodo community every deposit joins. |
| `zenodo.description_blurb` | | A paragraph added to every deposit's description, after the abstract. |
| `checks` | none | The editorial checks, one `id` each, plus `optional: true` and the check's own options. See [editorial checks](../guide/checks.md). |

(file-brand-yml)=
## brand/brand.yml

(file-editions)=
## editions/&lt;edition&gt;.yml

(file-registry)=
## registry/papers.yml

The papers the journal website lists, one entry each, in the order the website shows them. Every paper's Journal checks read it to keep ids unique. oak ignores fields it does not know. How to add a paper: [list it on the journal website](../guide/publish.md#list-on-site).

| field | default | |
|---|---|---|
| `id` | | The paper's `project.id`. Required. A paper whose own entry has another id fails its Journal checks. |
| `location` | | Where the paper is. Required. `owner/name` is a GitHub repository, with the paper at its root. A `./` or `../` path is a folder in the journal repository, relative to its root; the website cannot list one yet. |
| `site_url` | `https://<owner>.github.io/<name>` | The paper's website, when it is published somewhere else. |

The website reads each paper's title, keywords, edition and DOI from the paper's `myst.yml`. It lists every entry except a paper whose DOI is a Zenodo sandbox one (`10.5072/…`), which it leaves out with a warning in the build log. A paper with no DOI is listed. An entry oak cannot read is skipped by the Journal checks, with a warning, and fails the website build, naming the entry.

(file-pages-index)=
## pages/index.md

(file-site-workflow)=
## .github/workflows/site.yml
