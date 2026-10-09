(start-journal)=
# You just bootstrapped a journal

`oak bootstrap journal` created a public repository on GitHub with one commit in it, turned on GitHub Pages for the journal website, and linked the website from the repository page. Nothing was written to your machine, so the next steps are to clone the repository and edit its settings.

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

Every file here is yours to rewrite: `oak upgrade` updates paper repositories and leaves this one alone. The next steps cover the files to edit first; [Files in a journal repository](../reference/files.md) describes each one.

## 2. Edit journal.yml and the brand

Every paper build reads [`journal.yml`](../guide/journal-yml.md). Before the first paper, set:

`name`
: The journal's name. `--name` wrote it here and everywhere else the name appears: the text beside the logo, the venue printed on each paper's PDF, and the website's title. Without `--name`, each of those says `CHANGE-ME Journal`.

`id_pattern`
: The shape every paper's id must have. It starts as `^[a-z0-9]+-\d{4}-[a-z0-9-]+$`, which accepts `oak-2026-tidal-flats`. A paper whose id does not match fails its checks and cannot merge. See [id_pattern](../guide/journal-yml.md#id-pattern), including how to turn it off.

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

(first-deploy)=
## 4. Wait for the website

The website is served at `https://<owner>.github.io/<journal-repo>/`, or at your custom domain if the account has one, a few minutes after the first **Journal site** run in the repository's **Actions** tab finishes. If a later build fails, the last version deployed keeps serving.

## 5. Create a repository for each paper

A paper is built, checked and published from a repository of its own, so the journal has no papers until you create one. [Add a paper](../guide/add-paper.md) covers creating it with `oak bootstrap paper`, what the author finds there, and listing the paper on the journal website once it is published.

## Previewing before you push

```bash
oak start
```

In the journal repository, `oak start` serves the website with MyST as it is, the same way the **Journal site** workflow builds it. On a paper repository it does more; [Processing MyST markdown](../design/index.md#processing-myst) explains what oaktree-sapling adds around MyST.

:::{dropdown} Experimental: the journal and its paper in one repository
`oak bootstrap journal --co-located` puts the journal's settings and a single paper in one repository, with no journal website. It is experimental and the rest of this page does not apply to it.
:::
