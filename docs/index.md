(docs-home)=
# Oaktree Sapling

A toolkit to create free, simple journals run on GitHub, hosted on Zenodo and built with MystMD. Each paper lives in its own repository and builds itself into a website and a PDF; a separate journal repository holds the settings every paper build reads: the journal's name, its branding, the editorial checks a submission has to pass, and the list of what has been published. Publishing a version deposits it to Zenodo for a DOI.

`oak` is the command-line tool that sets those repositories up and does the building, checking, previewing and publishing.

::::{grid} 1 1 3 3

:::{card} Run a journal
[Before you start](start/setup.md): install `oak`, choose where the repositories live, create the journal.

[After bootstrap](start/journal.md): initialize your journal, make the first edits, push and watch the site go live.

[journal.yml](guide/journal-yml.md): every setting and what changing it does.

[Editorial checks](guide/checks.md): what a submission is held to.

[Branding](guide/branding.md): logo, colours, and further customization.

[Files](reference/files.md): reference documentation.
:::

:::{card} Write a paper
[Your paper repository](start/paper.md): what is in it, what to fill in, how to submit.

[Editorial checks](guide/checks.md): what your submission is held to.

The reference for writing the manuscript itself is a WIP!
:::

:::{card} Understand how it works
[How it works](design/index.md): the two-repository shape, what the engine wraps, and how a paper's configuration is assembled.

[Paper CI](design/paper-ci.md): why a paper repository's workflows look the way they do.
:::

::::
