# oaktree-sapling

A toolkit to create free, simple journals run on GitHub, archived on Zenodo and built with MystMD. Each paper lives in its own repository, whose CI builds it into a website and a PDF; a separate journal repository holds the settings every paper build reads: the journal's name, its branding, the editorial checks a submission has to pass, and the list of what has been published. Publishing a version deposits it to Zenodo for a DOI, and the `oak` command-line tool sets it all up and runs it.

The documentation is at [scholar.nexus/oaktree-sapling](https://scholar.nexus/oaktree-sapling).

## Status

Pre-1.0 and in active development. Documentation work is ongoing. Its original design served Neuromatch Impact Scholars Program 2025, but is being heavily revised to become suitable to more tenants, testable, extensible, versioned, etc.

## Features

- A website and a PDF for every paper, built by the paper repository's own CI, with the journal's branding on both.
- Editorial checks on every pull request, such as an abstract or an ORCID for every author, from the MIT-licensed [`@curvenote/check-implementations`](https://www.npmjs.com/package/@curvenote/check-implementations) and [`@curvenote/check-definitions`](https://www.npmjs.com/package/@curvenote/check-definitions). A journal can add checks of its own in JavaScript.
- A live preview link on each pull request, through Cloudflare Pages (optional).
- Publishing on Zenodo with a DOI, from a terminal or from the workflows.
- A journal website on GitHub Pages, listing the published papers.
- Each paper pins an engine version, and `oak upgrade` moves it to a newer one as a pull request.

## Install

```
npm install -g oaktree-sapling
oak
```

`oak` with no arguments prints the full usage, and the [CLI reference](https://scholar.nexus/oaktree-sapling/reference/cli) covers each command. To run a single command without installing, such as a bootstrap, use `npx oaktree-sapling@latest <command>`; without `@latest`, npx may reuse an older copy it cached.

`oak build` needs [typst](https://github.com/typst/typst) on your `PATH` for the PDF.

## Development

See `CONTRIBUTING.md`.

## License

BSD 3-Clause, copyright Neuromatch, Inc. See `LICENSE`.

One subtree is not covered by it: `templates/typst/` is the [LaPreprint](https://github.com/curvenote/lapreprint) typst template, MIT-licensed and copyright Rowan Cockett. It keeps its own `LICENSE` alongside it, which ships with the package and with every release tag.
