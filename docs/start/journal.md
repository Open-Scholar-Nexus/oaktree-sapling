(start-journal)=
# You just bootstrapped a journal

`oak bootstrap journal --external` created a public repository on GitHub with one commit in it, turned on GitHub Pages for the journal website, and linked the website from the repository page. Nothing was written to your machine, so the next steps are to clone the repository and edit its settings.

`--co-located` is experimental: it puts the journal's settings and a single paper in one repository, with no journal website. The rest of this page describes `--external`.

## 1. Clone it

```bash
git clone https://github.com/<owner>/<journal-repo>.git
cd <journal-repo>
```

```text
journal.yml                  the journal's settings
brand/brand.yml              logo, favicon, the text beside the logo
brand/logo.svg               a placeholder logo, yours to replace
editions/<edition>.yml       the first edition, named by --edition
registry/papers.yml          the list of published papers, empty for now
myst.yml                     the journal website
pages/index.md               the website's landing page
package.json                 the website's build dependencies
.gitignore                   keeps the website's build output out of git
.github/workflows/site.yml   builds and deploys the website on every push to main
```

Every file here is yours to rewrite: `oak upgrade` updates paper repositories and leaves this one alone. See [what each file is](../reference/files.md).

## 2. Edit journal.yml and the brand

Every paper build reads [`journal.yml`](../guide/journal-yml.md). Before the first paper, set:

`name`
: The journal's name. `--name` wrote it here and everywhere else the name appears: the text beside the logo, the venue printed on each paper's PDF, and the website's title. Without `--name`, each of those says `CHANGE-ME Journal`.

`id_pattern`
: The shape every paper's id must have. The seeded pattern is `^[a-z0-9]+-\d{4}-[a-z0-9-]+$`, which accepts `oak-2026-tidal-flats`. A paper whose id does not match fails its checks and cannot merge. See [id_pattern](../guide/journal-yml.md#id-pattern), including how to turn it off.

`checks`
: The editorial checks a paper has to pass. See [editorial checks](../guide/checks.md).

Then replace `brand/logo.svg` and rewrite `pages/index.md`. `brand/brand.yml` already has `logo_url` set to the website, so the logo on every paper's page links back to the journal. See [branding](../guide/branding.md).

(push-your-edits)=
## 3. Commit and push

The journal repository has no branch rules, so a push to `main` is enough:

```bash
git add -A
git commit -m "Set the journal's name and id pattern"
git push
```

The push redeploys the website. Paper builds read this repository when they run, so the next build of every paper, old and new, uses the settings you pushed.

To have changes to the journal reviewed before they take effect, add a branch rule to the repository yourself.

(first-deploy)=
## 4. Wait for the website

The website is served at `https://<owner>.github.io/<journal-repo>/`, or at your custom domain if the account has one. It appears when the first **Journal site** run in the repository's **Actions** tab finishes, and GitHub Pages can take another minute or two to serve a new site. Until then the address returns 404.

If a later build fails, the last version deployed keeps serving, so a bad entry in `registry/papers.yml` shows up as a failed run and the website stays up.

## Previewing before you push

The website is a MyST project, so you can serve it locally:

```bash
npm install     # once
oak start
```

`oak start` stops and asks for `npm install` if the dependencies are missing. `oak build` and `oak validate` work on papers and refuse to run in this repository.

## What comes next

Each submission gets its own paper repository, created with `oak bootstrap paper --instance <owner>/<journal-repo>`. What the author finds there is described in [your paper repository](paper.md). A paper appears on the journal website when an entry for it is added to [`registry/papers.yml`](../reference/files.md#file-registry).
