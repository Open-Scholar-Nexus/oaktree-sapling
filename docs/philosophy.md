(philosophy)=
# Philosophy

Oaktree Sapling sets up a journal on free services and on tools a researcher already uses or can learn in an afternoon. This page explains each choice, for anyone deciding whether to adopt it.

## Papers are written in MyST

[MyST](https://mystmd.org) is Markdown with what a paper needs added on top: citations, cross-references, equations, figures and Jupyter notebooks. If you have written a README, you can write a MyST paper.

MyST reads a document into a structure where each figure, equation and citation is known for what it is, so one source becomes both a website and a PDF. The website is where most reading happens: references preview on hover, figures can stay interactive, and a notebook's outputs sit in the paper next to the code that produced them. The PDF is for printing and citing. MyST can also export [JATS XML](https://mystmd.org/guide/creating-jats-xml).

:::{figure} #fig-gccm
:label: fig-philosophy-gccm
An interactive figure from a published paper: cross-map skill between land surface temperature (LST) and each candidate driver of urban heat in Ouagadougou, in both directions, with 95% confidence intervals. Data from [Lindner et al. (2026)](https://doi.org/10.5281/zenodo.20606263), Fig. 1D. Hover over a point for its values; click a legend entry to highlight one direction. In a paper's PDF, the chart is a static image ([how to embed one](https://mystmd.org/guide/reuse-jupyter-outputs)).
:::

MyST is open source and part of [Project Jupyter](https://jupyter.org).

## Papers live on GitHub

A paper is a folder of text files in a repository, so every change is recorded and every earlier version can be recovered[^versions]. Submission and review happen in pull requests: a reviewer's comment sits on the line it is about, and the author answers by changing that line[^review]. Many researchers already keep their code on GitHub, and the paper can sit next to it.

GitHub also builds each paper and hosts its website, so the journal has no server to maintain.

[^versions]: A published version is a git tag, so the text behind each DOI stays in the repository, and the differences between two versions are one comparison away.

[^review]: An author who has not used git before has to learn a few steps: fork, commit, push, open a pull request. [Your paper repository](start/paper.md) walks through each one.

## Published versions go to Zenodo

Publishing a version deposits it to [Zenodo](https://zenodo.org), which gives it a DOI and keeps a copy that outlives both the GitHub repository and the journal[^archive]. Zenodo is run by CERN.

[^archive]: Each paper gets one DOI that always resolves to its latest version, and each version gets its own. [Zenodo's policies](https://about.zenodo.org/policies/) keep records for as long as Zenodo runs, which is tied to CERN's lifetime, and promise best efforts to move them to another archive if it ever closes. A deposit holds the PDF, the paper's source and the version of the engine that built it, so the paper can be read and rebuilt without GitHub.

## Maintenance

A paper builds with the engine release named in its `myst.yml`, checked out from the engine repository at that release's tag. If the engine stops being maintained, each paper keeps building with the release it names, for as long as that release and the web theme it downloads stay on GitHub. A journal can also run its papers from its own fork of the engine repository, release tags included, by naming that fork in the paper's [`pins.yml`](src:templates/paper/.github/actions/engine/pins.yml#L4).

## Alternatives

[ReScience C](https://rescience.github.io)
: Publishes replications of computational studies. Each submission is reviewed in a public GitHub issue and published on Zenodo, using only GitHub and Zenodo. Oaktree Sapling is close to it in setup, and packages that setup as a tool: `oak` creates the repositories, the editorial checks run on every pull request, and a journal upgrades when the engine does.

[Journal of Open Source Software](https://joss.theoj.org)
: Publishes short Markdown papers about research software. It reviews them in GitHub issues, runs its own website and review bot, and registers DOIs with Crossref. With Oaktree Sapling, review happens in a pull request on the paper's own repository, and that repository's GitHub Actions build and publish it.

[NeuroLibre](https://neurolibre.org)
: Publishes preprints from Jupyter notebooks and MyST, and runs its own servers so readers can re-run the code. With Oaktree Sapling, each paper is a static website on GitHub Pages: readers see a notebook's saved outputs, and run the code by cloning the repository.

[Computo](https://computo-journal.org)
: Publishes computational work in statistics and machine learning, written in [Quarto](https://quarto.org). Each paper is built from a [GitHub template repository](https://computo-journal.org/site/guidelines-authors.html) with GitHub Actions and published on GitHub Pages, and review happens on OpenReview. With Oaktree Sapling, papers are written in MyST and reviewed in a pull request on the paper's repository.

[PubPub](https://www.pubpub.org)
: A hosted platform run by the nonprofit [Knowledge Futures](https://www.knowledgefutures.org). Authors and editors write in a browser editor, and the text is stored in PubPub's database. With Oaktree Sapling, a paper's source files live in a public repository the journal owns, and change through pull requests.

[Open Journal Systems](https://pkp.sfu.ca/software/ojs/)
: Journal software that runs on a server the journal installs or pays PKP to host, and handles submission and review through its web interface. [PKP counts](https://web.archive.org/web/20261016022114/https://pkp.sfu.ca/software/ojs/) more than 44,000 journals using it. With Oaktree Sapling, a journal is a set of GitHub repositories: submission and review happen in pull requests, and each paper's repository builds its own website.

## Costs and accounts

A journal set up with Oaktree Sapling has little to run: a paper is built only when it changes, and what readers get is a static website, which costs little to serve[^scope]. So every service it uses is free at its scale: GitHub Actions and Pages for public repositories, Cloudflare Pages for the previews, and Zenodo[^sustainability].

An author needs a GitHub account. The journal also needs a Cloudflare account for the previews and a Zenodo account for the deposits.

[^scope]: That covers review in pull requests, papers built by GitHub Actions, a static website for readers, and a permanent copy of each published version on Zenodo. As a journal system adds features, each addition brings its own service and its own cost: collaborative editing, email reminders, an external review platform, other integrations, and running a paper's code for its readers.

[^sustainability]: Of these, GitHub Pages and Cloudflare Pages are the simplest to swap to alternatives. Actions have especially large limits among alternatives, but a journal uses a few minutes of build per change. Zenodo mints DOIs and keeps the archived copies; replacing it would need another provider that mints DOIs at no cost, and a deposit in `oak` written for it.
