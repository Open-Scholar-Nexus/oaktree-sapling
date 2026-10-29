(guide-publish)=
# Publish a paper on Zenodo

Publishing a paper deposits it on Zenodo, which gives it a DOI. An editor does it from the paper repository on GitHub once `main` holds the paper as it should be published, and again for each [new version](#new-version). It needs the paper repository's [Zenodo tokens](../reference/secrets.md).

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

(sandbox)=
:::{dropdown} Testing on the Zenodo sandbox
With **Use the Zenodo sandbox** ticked, the DOI is a sandbox one (`10.5072/zenodo.…`), and tags deposit on [sandbox.zenodo.org](https://sandbox.zenodo.org) with `ZENODO_TOKEN_SANDBOX`. A sandbox DOI never resolves, and the journal website leaves out a paper that has one. A paper with no DOI yet is listed.

To move to the real Zenodo, run **Reserve DOI** again with the box unticked. Its pull request replaces the sandbox DOI with a real one.
:::

[^dois]: Zenodo calls the DOI for all versions the concept DOI. It resolves to the newest version, and it is the one written into `myst.yml`. A version's own DOI always resolves to that version.
