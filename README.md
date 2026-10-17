# oaktree-sapling

A journal engine for small publications built on [MyST](https://mystmd.org), GitHub and Zenodo.

One repo holds the journal: its settings, branding, editions and the list of published papers.
Each paper gets a repo of its own, with CI that builds a website and a PDF, runs the journal's checks on every pull request, publishes a preview, and deposits the final version to Zenodo for a DOI. `oak` is the command line tool that sets those repos up and does the work inside them.

Papers refer to the engine by a single version coordinate, so a journal upgrades by changing one line rather than by copying workflow files around.

The documentation is at [scholar.nexus/oaktree-sapling](https://scholar.nexus/oaktree-sapling).

## Status

Pre-1.0 and in active development. Every command is implemented and the CI is being tested end to end against real GitHub, Cloudflare and Zenodo, but interfaces may still change between 0.x versions and the documentation is incomplete. Its original design served Neuromatch Impact Scholars Program 2025, but is being heavily revised to become suitable to more tenants.

## Install

```
npm install -g oaktree-sapling
oak
```

`oak` with no arguments prints the full usage. To run a single command without installing, such as a bootstrap, use `npx oaktree-sapling <command>`.

## Commands

Setting up repos:

- `oak bootstrap journal`: create the journal repo (settings, branding, paper list)
- `oak bootstrap paper`: create a paper repo pointing at a journal
- `oak upgrade`: move a paper repo to a newer engine version, as a pull request

Working on a paper:

- `oak validate`: run the journal's checks over a manuscript
- `oak build`: build the paper's website and PDF into `_build/`
- `oak start`: preview it in a browser with the journal's settings applied

The rest (`post-checks`, `deploy-preview`, `deposit`, `release`, `notify`, `conformance`) are run by the generated workflows and are rarely typed by hand.

## What runs from the npm package

The package runs the commands for setting up repos and working on a paper. The ones the workflows run (`post-checks`, `deploy-preview`, `deposit`, `release`, `notify`, `conformance`) run in CI, from a checkout of a release tag.

`oak build` exports the PDF with the [typst](https://github.com/typst/typst) on your `PATH`, as for any local build. In CI, the release tag's linux x86_64 `bin/typst` is put on `PATH`.

## Editorial checks

`oak validate` runs two kinds of check. The engine's own invariants are built in. The editorial checks a journal selects (authors exist, have ORCIDs, have valid CRediT roles, abstract exists, keywords defined) come from the MIT-licensed [`@curvenote/check-implementations`](https://www.npmjs.com/package/@curvenote/check-implementations) and [`@curvenote/check-definitions`](https://www.npmjs.com/package/@curvenote/check-definitions). The engine supplies the runner and the GitHub Check Run reporter.

## Development

```
npm install
npm test
npm run typecheck
```

`NOTES.md` has the module map and the build internals. `RELEASING.md` explains how releases are cut and why the built bundle is committed at the tag. `STYLE.md` and `WRITING.md` are the conventions a change is reviewed against, for code and for prose.

## License

BSD 3-Clause, copyright Neuromatch, Inc. See `LICENSE`.

One subtree is not covered by it: `templates/typst/` is the [LaPreprint](https://github.com/curvenote/lapreprint) typst template, MIT-licensed and copyright Rowan Cockett. It keeps its own `LICENSE` alongside it, which ships with the package and with every release tag.
