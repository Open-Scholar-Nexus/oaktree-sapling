(guide-branding)=
# Branding

`brand/brand.yml`, in the journal repository, sets the journal's look: the header of every paper's website and of the journal website, and the first page of every paper's PDF.

```yaml
site:
  options:
    logo_text: My Journal
    logo: brand/logo.svg
    favicon: brand/favicon.svg
    logo_url: https://<owner>.github.io/<journal-repo>/
    style: brand/journal.css
project:
  options:
    logo: brand/logo.svg
    theme: green.darken(30%)
```

Papers extend this file like any MyST config, so `site.options` takes any of MyST's [site options](https://mystmd.org/guide/website-templates#site-options). A path in this file starts at the journal repository root, as in `brand/logo.svg`, and the file has to be committed in that repository. The same path works on every paper and on the journal website. `logo`, `favicon` and `style` can also be full URLs.

(website-paths)=
On the journal website, a path that finds no file fails the build: MyST itself only warns, so the site workflow checks its log for the warning.

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
