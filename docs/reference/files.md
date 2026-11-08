(ref-files)=
# Files in a journal repository

*Work in progress.*

(file-journal-yml)=
## journal.yml

Every time a paper is built, it loads the journal's settings. They live in the journal repository, in `journal.yml`. Every field but `name` is optional, and oak ignores fields it does not know. How to use them: [Configure the journal](../guide/journal-yml.md).

A parsing error[^journal-error] in `journal.yml` stops every oak command and names the file and the line. A pull request preview falls back to the artifact link instead, and says why in its comment. oak reads a paper's `myst.yml` and `pins.yml` the same way.

[^journal-error]: Invalid YAML (a key written twice, an unquoted value holding `: `, or a `---` line that starts a second document), or a field of the wrong type.

| field | default | |
|---|---|---|
| `name` | | The journal's name. Required. `oak bootstrap journal --name` also writes it to the brand's `logo_text`, the edition's `venue` and the website's title, which are what the papers show. |
| `url` | | The journal's address, for people reading the file. |
| `checks` | none | The editorial checks every paper must pass, and their options. See [editorial checks](../guide/checks.md). |
| `typst_template` | oak's template | The PDF template: a `./` or `../` path in the journal repository, a URL, or a MyST template name. See [your own PDF template](../guide/journal-yml.md#typst-template). |
| `preview.provider` | `artifact` | `cloudflare` for live previews on Cloudflare Pages, `artifact` for a downloadable copy.[^providers] See [live previews](../guide/journal-yml.md#live-previews). |
| `preview.cf_project_name` | | The Cloudflare Pages project the previews go to. |
| `preview.branch_pattern` | `paper-{repo}-{pr}` | The name of each preview inside the project, with `{repo}` and `{pr}` filled in. It is lowercased and cut to 28 characters by shortening `{repo}`, which then ends in a 4-character hash so that papers with similar names stay distinct. |
| `zenodo.community` | | The Zenodo community every deposit joins. |
| `zenodo.description_blurb` | | A paragraph added to every deposit's description, after the abstract. |
| `id_pattern` | | A regular expression every paper's `project.id` must match, when set. See [the paper id rule](../guide/journal-yml.md#id-pattern). |
| `tier` | `paper` | Only `paper` is built.[^tier] |
| `id_sentinel` | | An id rejected as a placeholder, besides `CHANGE-ME-template-placeholder`. |

[^tier]: `edition` and `journal` are reserved for a repository that holds an edition's papers or the whole journal's. Neither is built yet.
[^providers]: More providers may be added later.

(file-brand-yml)=
## brand/brand.yml

(file-editions)=
## editions/&lt;edition&gt;.yml

(file-registry)=
## registry/papers.yml

The papers the journal website lists, one entry each, in the order the website shows them. It is also used by every paper's _Journal checks_ to keep ids unique. `oak` ignores fields it does not know. How to add a paper: [list it on the journal website](../guide/publish.md#list-on-site).

| field | default | |
|---|---|---|
| `id` | | The paper's `project.id`.[^registry-id] Required. When it differs from the `project.id` of the paper at `location`, that paper's Journal checks fail. |
| `location` | | Where the paper is. Required. `owner/name` is a GitHub repository, with the paper at its root. A `./` or `../` path is a folder in the journal repository, relative to its root: `./papers/<id>` in a [co-located journal](../guide/co-located.md), whose website then serves the paper at `/<id>/`. |
| `site_url` | `https://<owner>.github.io/<name>/`, or `https://<owner>.github.io/` for a repository named `<owner>.github.io` | The paper's website, when it is published somewhere else. The journal website and the paper's Zenodo deposit both link it. |

The website reads each paper's title, keywords, edition and DOI from the paper's `myst.yml`. It lists every entry except a paper whose DOI is a Zenodo sandbox one (`10.5072/…`), which it leaves out with a warning in the build log. A paper with no DOI is listed. An entry oak cannot read is skipped by the _Journal checks_ with a warning, and fails the website build naming the entry.

[^registry-id]: The registry keeps each id so that a paper's _Journal checks_ compare ids from this file alone, without fetching every other paper, and so that a listed paper cannot change its id: the registry is the journal's, and `myst.yml` is the author's.

(file-check-files)=
## checks/&lt;name&gt;.mjs

The journal's custom checks, one JavaScript module each, in `checks/` (any folder works: [`checks`](#file-journal-yml) in `journal.yml` lists each check by its path). Every paper's Journal checks run them. How to write one: [custom checks](../guide/checks.md#journal-checks).

(file-pages-index)=
## pages/index.md

(file-site-workflow)=
## .github/workflows/site.yml
