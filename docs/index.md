(docs-home)=
# Oaktree Sapling

A toolkit to create free, simple journals run on GitHub, hosted on Zenodo and built with MystMD. Each paper lives in its own repository and builds itself into a website and a PDF; a separate journal repository holds the settings every paper build reads: the journal's name, its branding, the editorial checks a submission has to pass, and the list of what has been published. Publishing a version deposits it to Zenodo for a DOI, and the `oak` command-line tool sets it all up and runs it.

::::{grid} 1 1 2 2

:::{card} Run a journal
Set up the journal's repositories, then one per submission.

[Create a journal](start/setup.md) · [Add a paper](guide/add-paper.md)
:::

:::{card} Submit a paper
An editor created a repository for your paper: what to fill in and how to submit.

[Your paper repository](start/paper.md)
:::

:::{card} Look something up
Each file in a journal repository, and each `oak` command.

[Files](reference/files.md) · [CLI](reference/cli.md)
:::

:::{card} Why it's built this way
Why MyST, GitHub and Zenodo, for anyone deciding whether to run a journal on it. Then the design in detail, for anyone forking it.

[Philosophy](philosophy.md) · [How it works](design/index.md)
:::

::::
