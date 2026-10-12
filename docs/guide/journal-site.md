(guide-journal-site)=
# The journal website

`oak bootstrap journal` puts the journal website in the journal repository, beside the settings: `myst.yml`, the pages under `pages/`, and `package.json` with the website's build dependencies.

The **Journal site** workflow builds it and deploys it to GitHub Pages on every push to `main`.

## Pages

`pages/index.md` is the landing page. To add a page, create a file under `pages/` and list it under `project.toc` in `myst.yml`. The [MyST guide](https://mystmd.org/guide) covers the syntax, and [branding](branding.md) the logo and colours.

## The list of papers

```markdown
:::{paper-cards}
:::
```

`paper-cards` shows one card per paper in `registry/papers.yml`, in the order of the file: the title and keywords, read from the paper's `myst.yml` at build time, the thumbnail, and the DOI from the registry. The card links to the paper's website. [Publish a paper](publish.md#list-on-site) covers the registry entry.

With `:edition:`, it shows the papers of one edition only, for a page per edition:

```markdown
:::{paper-cards}
:edition: 2026
:::
```

The website reads each paper when it builds. To show a change to a paper's title or thumbnail, run **Journal site** again from the **Actions** tab (**Run workflow**).

A paper whose `myst.yml` cannot be fetched fails the build, for example a private repository or a wrong `location.repo`; the error names the entry. A paper with no `thumbnails/thumbnail.png` gets a card without a picture.

## Previewing it

```bash
npm install
oak start
```

`npm install` fetches `js-yaml`, which the `paper-cards` plugin needs to read the registry, once per clone.

## Who can change it

Anyone with write access to the journal repository can push to `main`, which redeploys the website. To require a reviewed pull request, add a branch rule in the repository's **Settings**.

## Leaving out the website

`oak bootstrap journal --no-site` leaves out the website and its workflow. The repository then holds only the settings papers read.

## Versions

The website's MyST version, theme and `paper-cards` plugin are fixed when the journal is bootstrapped, and nothing updates them: see [Keeping versions current](pins.md#site-pins).
