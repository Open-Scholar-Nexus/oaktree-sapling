(guide-publish)=
# Publish a paper on Zenodo

Publishing a paper deposits it on Zenodo, which gives it a DOI. An editor does it from the paper repository on GitHub once `main` holds the paper as it should be published, and again for each [new version](#new-version). It needs the paper repository's [Zenodo tokens](add-paper.md#paper-secrets).

## 1. Reserve the DOI

In the paper repository's **Actions** tab, open **Prepare Zenodo deposit** and click **Run workflow**. Untick **Use the Zenodo sandbox** for a real deposit: it is ticked by default, which deposits on the [Zenodo sandbox](#sandbox).

The run creates a draft on Zenodo and opens a pull request, **Reserve Zenodo DOI**, that writes the DOI into `myst.yml`. Merge it. The run that opened it posts its Journal checks; the other runs on it wait for approval and are not needed to merge.

(tag-version)=
## 2. Tag the version

Tag the merged `main` with a version number in the form `vMAJOR.MINOR.PATCH`, and push the tag:

```bash
git switch main
git pull
git tag v1.0.0
git push origin v1.0.0
```

Creating a release with a new tag on GitHub does the same. Only editors can create `v*` tags.

The tag starts the **Publish Zenodo deposit** workflow, which builds the paper and uploads the PDF, the sources and the engine that built them to the Zenodo draft. It attaches the same files to a GitHub release for the tag, and comments the draft's address on the tagged commit.

## 3. Publish on Zenodo

Open the draft on Zenodo, check it, and click **Publish**. The DOI resolves from then on.

To show the paper on the journal website, add its entry, with the DOI, to the journal's registry: see [List it on the journal website](add-paper.md#list-on-site).

(new-version)=
## Publish a new version

A published paper keeps one DOI for all its versions, and each version gets a DOI of its own as well. For each new version:

1. On the paper's Zenodo record, click **New version**. This creates the empty draft the next tag fills.
2. Tag the new version, as in [step 2](#tag-version).
3. Click **Publish** on the new draft.

Once a paper is published, every pull request to it gets a comment reminding the editors of step 1, and the `editor-action-needed` label.

(sandbox)=
## Test on the Zenodo sandbox

With **Use the Zenodo sandbox** ticked, the DOI is a sandbox one (`10.5072/zenodo.…`), and tags deposit on [sandbox.zenodo.org](https://sandbox.zenodo.org) with `ZENODO_TOKEN_SANDBOX`. A sandbox DOI never resolves.

To move to the real Zenodo, run **Prepare Zenodo deposit** again with the box unticked. Its pull request replaces the sandbox DOI with a real one.

## When the publish run fails

The run opens an issue titled **Zenodo publish failed for** the tag, labelled `zenodo-publish-failed`, with the reason. A common one is a new version tagged before **New version** was clicked on Zenodo. Fix the cause, then open the failed run and click **Re-run failed jobs**.
