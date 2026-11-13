(ref-files)=
# Files in a journal repository

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

The journal's look: the header of every paper's website and of the journal website, and the logo and colour on each paper's PDF. Every paper's settings extend this file, and so does the journal website's `myst.yml`. A file path in it starts at the journal repository root, as in `brand/logo.svg`. The fields: [Branding](../guide/branding.md).

`oak bootstrap journal` writes the journal's name as `logo_text` and the website's address as `logo_url`. The `logo` and `favicon` lines start commented out. Until `favicon` is set, every paper's Journal checks show a warning.

(file-editions)=
## editions/&lt;edition&gt;.yml

The settings every paper in one edition shares, such as the venue and the licence. The file's name, without `.yml`, is the edition's id. A paper names its edition under `project.options.oaktree-sapling.edition` in its `myst.yml`. An id holds letters, digits, `.`, `_` and `-`, and starts with a letter or a digit.

The file is MyST frontmatter: each field under `project` applies to every paper of the edition. A field the paper's own `myst.yml` sets takes precedence. The edition file cannot change the paper's engine version or edition: a build where it does fails.

A paper whose edition has no file here does not build, and its Journal checks fail.

`oak bootstrap journal --edition` names the first edition, `seedling` by default, and writes the journal's name as its `venue`. To add an edition, copy the file under the new id. The journal website can show a page per edition: see [pages/index.md](#file-pages-index).

(file-registry)=
## registry/papers.yml

The papers the journal website lists, one entry each, in the order the website shows them. It is also used by every paper's _Journal checks_ to keep ids unique. `oak` ignores fields it does not know. How to add a paper: [list it on the journal website](../guide/publish.md#list-on-site).

| field | default | |
|---|---|---|
| `id` | | The paper's `project.id`.[^registry-id] Required. When it differs from the `project.id` of the paper at `location`, that paper's Journal checks fail. |
| `location` | | Where the paper is. Required. `owner/name` is a GitHub repository, with the paper at its root. A `./` or `../` path is a folder in the journal repository, relative to its root. The website build fails on one. |
| `site_url` | `https://<owner>.github.io/<name>/`, or `https://<owner>.github.io/` for a repository named `<owner>.github.io` | The paper's website, when it is published somewhere else. The journal website and the paper's Zenodo deposit both link it. |

The website reads each paper's title, keywords, edition and DOI from the paper's `myst.yml`. It lists every entry except a paper whose DOI is a Zenodo sandbox one (`10.5072/…`), which it leaves out with a warning in the build log. A paper with no DOI is listed. An entry oak cannot read is skipped by the _Journal checks_ with a warning, and fails the website build naming the entry.

[^registry-id]: The registry keeps each id so that a paper's _Journal checks_ compare ids from this file alone, without fetching every other paper, and so that a listed paper cannot change its id: the registry is the journal's, and `myst.yml` is the author's.

(file-check-files)=
## checks/&lt;name&gt;.mjs

The journal's custom checks, one JavaScript module each, in `checks/` (any folder works: [`checks`](#file-journal-yml) in `journal.yml` lists each check by its path). Every paper's Journal checks run them. How to write one: [custom checks](../guide/checks.md#journal-checks).

(file-pages-index)=
## pages/index.md

The journal website's landing page. `oak bootstrap journal` writes it once, with the journal's name as its heading, and never changes it. Its `paper-cards` directive lists every paper in [`registry/papers.yml`](#file-registry). The directive: [the list of papers](../guide/journal-site.md#paper-cards).

To give each edition a page of its own:

1. Create a file under `pages/` for each edition.
2. In each, put a `paper-cards` directive with `:edition: <id>`, which lists only the papers of that edition.
3. List each file under `project.toc` in `myst.yml`.

(file-site-workflow)=
## .github/workflows/site.yml

The **Journal site** workflow builds the journal website and deploys it to GitHub Pages. It runs on every push to `main`, and from the **Actions** tab with **Run workflow**.

It installs the dependencies in `package.json`, then runs `myst build --html --strict`. The build fails when the `paper-cards` plugin did not load, or when a file named in the settings was not found. MyST only warns about both, so the workflow looks for them in the build log.

When a build fails, the website keeps serving the last version deployed. `oak upgrade` leaves this file alone, so the versions of its actions change only when you edit it.
