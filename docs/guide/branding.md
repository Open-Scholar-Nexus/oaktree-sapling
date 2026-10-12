(guide-branding)=
# Branding

`brand/brand.yml`, in the journal repository, sets the journal's look: the header of every paper's website and of the journal website, and the first page of every paper's PDF.

```yaml
site:
  options:
    logo_text: My Journal
    logo: https://example.org/logo.svg
    favicon: https://example.org/favicon.svg
    logo_url: https://<owner>.github.io/<journal-repo>/
    style: ./journal.css
project:
  options:
    logo: ./logo.svg
    theme: green.darken(30%)
```

Papers extend this file like any MyST config, so `site.options` takes any of MyST's [site options](https://mystmd.org/guide/website-templates#site-options). A path in this file is relative to `brand/`, and the file has to be committed there.

(website-paths)=
:::{note} Paths on the journal website
The journal website reads this file too, but resolves its paths from the repository root, where they find no file, so the website goes without them. For the website, set `logo`, `favicon` and `style` again under `site.options` in its `myst.yml`, as paths from the repository root (`brand/logo.svg`), or give `logo` and `favicon` as full URLs here.
:::

(logo-text)=
## The header

`logo_text`
: The text beside the logo at the top of every page. `oak bootstrap journal --name` sets it to the journal's name.

`logo`, `logo_dark`
: The logo in the header, and a version of it for dark mode.

`logo_url`
: Where clicking the logo leads, as a full `https://` address. `oak bootstrap journal` sets it to the journal website, so every paper links back to the journal.

`favicon`
: The icon in the browser tab. Without one, the Journal checks show a warning.

(colours)=
## Colours

On the websites, colours come from a CSS file named by `style`, MyST's [custom stylesheet](https://mystmd.org/guide/website-style). The theme reads its colours from CSS variables named `--myst-color-…`, so the file sets the ones to change, for light mode under `:root` and dark mode under `.dark`:

```css
:root {
  --myst-color-primary: #2f6b3a;
  --myst-color-link: #2f6b3a;
}
.dark {
  --myst-color-primary: #7fbf8a;
  --myst-color-link: #7fbf8a;
}
```

MyST's [styling guide](https://myst-theme.netlify.app/theming) explains what each variable colours, and its [colour picker](https://myst-theme.netlify.app/color-picker) shows the result live. The variables the papers' theme reads, with their defaults, are in its [`theme-colors.css`](https://github.com/impact-scholars/myst-theme/blob/v0.2.0/styles/theme-colors.css).

On the PDF, `theme` under `project.options` sets the colour of the title and links, as a [typst colour](https://typst.app/docs/reference/visualize/color/), such as `rgb("#2f6b3a")` or `green.darken(30%)`.

(pdf-logo)=
## The logo on the PDF

`logo` under `project.options` is the image at the top right of the PDF's first page. It has to be a file committed in the journal repository: typst cannot fetch a URL. A new journal starts with a placeholder, `brand/logo.svg`, to replace.
