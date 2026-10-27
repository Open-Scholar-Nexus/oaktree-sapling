(guide-publish)=
# Publish a paper on Zenodo

Publishing a paper deposits it on Zenodo, which gives it a DOI. An editor does it from the paper repository on GitHub once `main` holds the paper as it should be published, and again for each [new version](#new-version). It needs the paper repository's [Zenodo tokens](add-paper.md#paper-secrets). A journal that keeps the tokens off GitHub runs the same steps [from the terminal](#from-terminal).

## 1. Reserve the DOI

In the paper repository's **Actions** tab, open **Reserve DOI** and click **Run workflow**. Untick **Use the Zenodo sandbox** for a real deposit: it is ticked by default, which deposits on the [Zenodo sandbox](#sandbox).

The run creates a draft on Zenodo and opens a pull request, **Reserve Zenodo DOI**, that writes the DOI into `myst.yml`. GitHub holds the checks on a pull request a workflow opens, and approving them does not run the preview, so close and reopen it to run both, then merge it.

(tag-version)=
## 2. Tag the version

Tag the merged `main` with a version number in the form `vMAJOR.MINOR.PATCH`, and push the tag:

```bash
git switch main
git pull
git tag v1.0.0
git push origin v1.0.0
```

Creating a release with a new tag on GitHub does the same. Only editors can create `v*` tags. Only tags in that form are supported: the **Deposit version** workflow fails on any other, such as `v1.0.0-rc1`.

The tag starts the **Deposit version** workflow, which builds the paper and uploads the PDF, the sources, and the engine and journal settings that built them to the Zenodo draft ([what a deposit carries](#design-releases-deposit)). It attaches the same files to a GitHub release for the tag, and comments the draft's address on the tagged commit. The deposit links the paper's website.

(publish-on-zenodo)=
## 3. Publish on Zenodo

Open the draft on Zenodo, check it, and click **Publish**. The DOI resolves from then on.

(list-on-site)=
## 4. List it on the journal website

The journal website shows the papers listed in the journal repository's `registry/papers.yml`. Add an entry for the paper to that file, then push it:

```yaml
- id: oak-2026-tidal-flats
  location: <owner>/<paper-repo>
```

`id` is the paper's `project.id`, and the Journal checks of every paper use this list to keep ids unique. `location` is the paper's GitHub repository. The website reads each paper's title, keywords, edition, DOI and thumbnail from its repository, so the paper repository has to be public. See [the registry file](../reference/files.md#file-registry) for every field.

(new-version)=
## Publish a new version

A published paper keeps one DOI for all its versions, and each version gets a DOI of its own as well.[^dois] For each new version:

1. (click-new-version)=
   On the paper's Zenodo record, click **New version**. This creates the empty draft the next tag fills.
2. Tag the new version, as in [step 2](#tag-version).
3. Click **Publish** on the new draft.

Once a paper is published, every pull request to it gets a comment reminding the editors to click [**New version**](#click-new-version) on Zenodo, and the `editor-action-needed` label.

## Leaving files out of the deposit

`source.zip` holds what is committed at the tag. To leave a committed folder out, such as a large data set, mark it in `.gitattributes`:

```
data/ export-ignore
```

The PDF is rendered from the files in the repository, with notebook outputs as they were saved, so the data a figure was made from can be left out. A file the manuscript points to must stay: a figure's image, a notebook it embeds, a file it includes. Without it, the PDF in the deposit cannot be rendered again.

`export-ignore` also leaves the folder out of GitHub's source downloads.

## When the publish run fails

The run opens an issue titled **Zenodo publish failed for** the tag, labelled `zenodo-publish-failed`, with the reason. A common one is a new version tagged before **New version** was clicked on Zenodo. Fix the cause, then open the failed run and click **Re-run failed jobs**.

(from-terminal)=
## Publishing from the terminal

The Zenodo tokens are optional on GitHub. Zenodo gives a personal token its owner's full rights whatever scopes it lists, so a token stored on GitHub lets the workflows that hold it publish and edit every record of the account. A journal that does not want that leaves the tokens unset, and an editor runs the Zenodo steps from a clone of the paper repository instead. Without a token, **Deposit version** still builds the tag and ends with a notice saying to deposit from the terminal, and **Reserve DOI** fails, pointing at `oak deposit prepare`.

This needs `oak`, [gh](https://cli.github.com) logged in (`gh auth login`) as an editor of the paper repository, and a Zenodo token in `ZENODO_TOKEN`, or in `ZENODO_TOKEN_SANDBOX` for the [sandbox](#sandbox). Create it under **Applications** in the account settings on [Zenodo](https://zenodo.org/account/settings/applications/) or the [sandbox](https://sandbox.zenodo.org/account/settings/applications/). `oak deposit` and `oak release` run the `oak` version the paper's `myst.yml` names, as [`oak build` does](pins.md#pins-local).

To reserve the DOI, in the clone, on an up-to-date `main`:

```bash
git switch main
git pull
oak deposit prepare
```

It creates a draft on Zenodo and opens the **Reserve Zenodo DOI** pull request. `--sandbox` reserves the DOI on the sandbox.

To fill the draft, [tag the version](#tag-version) as usual. Once its **Deposit version** run has built it, check out the tag and run `oak release`:

```bash
git fetch --tags
git checkout v1.0.0
oak release --tag v1.0.0
```

`oak release` downloads the build of that run, after checking that the run is the push of that tag at the tag's commit. It uploads the same files the workflow does, attaches them to the tag's GitHub release, and comments the draft's address on the tagged commit. The clone has to be at the tag, with no changes to tracked files, since the deposit archives the commit checked out and reads `myst.yml` from the working tree. Then [publish on Zenodo](#publish-on-zenodo) as usual. For a [new version](#new-version), run `oak release` for its tag after pushing it.

`oak release` refuses while the run is still building, and when the build failed, with a link to the run. When Zenodo refuses, it prints the reason.

(local-build)=
### Building on your computer

`oak release --local-build` builds the paper on your computer and deposits that build. The build runs the paper's code: MyST loads the plugins the paper's `myst.yml` lists, as JavaScript with your permissions, while the Zenodo token is in the environment. `oak` warns first and lists the plugins the paper adds beyond the journal's and the engine's gallery plugin; [read them](checks.md#validate-runs-paper-code) before going on. Set up any environment `paper-environment.yml` describes yourself: `oak` does not install it, since installing runs package scripts.

The engine's typst is built for Linux on x86_64. On another machine, such as a Mac or an arm64 computer, the PDF is exported with the typst on your `PATH`, so it can differ from the one the CI build makes. The deposit's provenance records the typst version that ran.

`--no-build` deposits the build already in the clone's `_build/` as it is, after a warning: nothing checks that it is the tag's build, and the provenance records it as the CI's platform and typst.

(publish-without-review)=
### Publishing without review

`oak release --publish-without-review` publishes the draft as soon as it is filled, so the version gets its DOI with no check on Zenodo first. Once it is published, Zenodo does not let its files change.

(sandbox)=
:::{dropdown} Testing on the Zenodo sandbox
With **Use the Zenodo sandbox** ticked, the DOI is a sandbox one (`10.5072/zenodo.…`), and tags deposit on [sandbox.zenodo.org](https://sandbox.zenodo.org) with `ZENODO_TOKEN_SANDBOX`. A sandbox DOI never resolves, and the journal website leaves out a paper that has one. A paper with no DOI yet is listed.

To move to the real Zenodo, run **Reserve DOI** again with the box unticked. Its pull request replaces the sandbox DOI with a real one.
:::

[^dois]: Zenodo calls the DOI for all versions the concept DOI. It resolves to the newest version, and it is the one written into `myst.yml`. A version's own DOI always resolves to that version.
