(guide-publish)=
# Publish a paper on Zenodo

Oaktree Sapling supports creating drafts on Zenodo. Publishing a paper on Zenodo also gives it a DOI. An editor does it once `main` holds the paper as it should be published, and again for each [new version](#new-version). Since the paper's `myst.yml` needs to contain the DOI assigned by Zenodo, publishing the first version has a preliminary step called "reserving the DOI". 

Oaktree Sapling can publish either with a workflow on GitHub, or with a command run locally. To use the GitHub workflow, the paper repository must have access to [Zenodo tokens](../reference/secrets.md). Alternatively, an editor can run the same steps [from the terminal](#from-terminal)[^current-security].

[^current-security]: Until Zenodo handles token scopes correctly, we recommend publishing from the terminal ([why](../reference/secrets.md)).

## 1. Reserve the DOI

Run the paper repository's **Reserve DOI** workflow, or `oak deposit prepare` from the terminal:

::::{tab-set}
:::{tab-item} gh
```bash
REPO=owner/paper-repo   # the paper repository
gh workflow run reserve-doi.yml --repo "$REPO"
```

`-f sandbox=true` reserves the DOI on the [Zenodo sandbox](#sandbox), for a test.
:::
:::{tab-item} GitHub website
In the paper repository's **Actions** tab, open **Reserve DOI** and click **Run workflow**. Tick **Use the Zenodo sandbox** to test a deposit on the [Zenodo sandbox](#sandbox).
:::
:::{tab-item} oak
With the Zenodo token on your computer ([setup](#from-terminal)):

```bash
REPO=owner/paper-repo   # the paper repository
gh repo clone "$REPO" paper && cd paper
oak deposit prepare
```

`--sandbox` reserves the DOI on the [Zenodo sandbox](#sandbox), for a test.
:::
::::

The run creates an empty draft on Zenodo to reserve a DOI and opens a pull request, **Reserve Zenodo DOI**, that writes the DOI into `myst.yml`, for you to merge.[^bot-pr-checks] Once main's `myst.yml` contains the reserved DOI, you're ready to fill the draft[^concept-vs-version-doi].

[^bot-pr-checks]: For this automated change, the **Journal checks** are skipped ([why](#design-paper-ci-limits)).

[^concept-vs-version-doi]: The reserved DOI is the paper's concept DOI: one DOI for all its versions, which resolves to the newest. Each version also gets a DOI of its own when its draft is published on Zenodo, and that one always resolves to that version.

(tag-version)=
## 2. Tag the version

Tag the merged `main` with a version number in the form `vMAJOR.MINOR.PATCH`, and push the tag:

::::{tab-set}
:::{tab-item} gh
With no clone, `gh` tags the newest commit of `main` on GitHub:

```bash
REPO=owner/paper-repo   # the paper repository
VERSION=v1.0.0
gh api "repos/$REPO/git/refs" -f ref="refs/tags/$VERSION" \
  -f sha="$(gh api "repos/$REPO/commits/main" -q .sha)"
```
:::
:::{tab-item} git
In a clone of the paper repository:

```bash
VERSION=v1.0.0
git switch main
git pull
git tag "$VERSION"
git push origin "$VERSION"
```
:::
:::{tab-item} GitHub website
In the paper repository, open **Releases** and click **Draft a new release**. Under **Choose a tag**, type the new tag, such as `v1.0.0`, keep `main` as the target, and click **Publish release**.
:::
::::

Only editors can create `v*` tags. Only tags in that form are supported: the **Deposit version** workflow fails on any other, such as `v1.0.0-rc1`.

Creating the tag starts the **Deposit version** workflow, which builds the paper and uploads the PDF, the sources, and the engine and journal settings that built them to a GitHub release. If Zenodo tokens are set, it also uploads everything to the Zenodo draft ([what a deposit carries](#design-releases-deposit)) and comments the draft's address on the tagged commit. The deposit links the paper's website.

Without Zenodo tokens on GitHub, the workflow ends with a notice. Once it has finished, deposit its build from the terminal ([setup](#from-terminal)):

```bash
REPO=owner/paper-repo   # the paper repository
VERSION=v1.0.0
gh repo clone "$REPO" paper -- --branch "$VERSION" && cd paper
oak release --tag "$VERSION"
```

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

`id` is the paper's `project.id`, and the Journal checks of every paper use this list to keep ids unique. `location` is the paper's repository. The website reads each paper's title, keywords, edition, DOI and thumbnail from its repository, so the paper repository has to be public. See the registry file [reference](../reference/files.md#file-registry) for every field.

(new-version)=
## Publish a new version

A published paper keeps one DOI for all its versions, and each version gets a DOI of its own as well[^concept-vs-version-doi]. For each new version:

1. (click-new-version)=
   On the paper's Zenodo record, click **New version**. This creates the empty draft the next tag fills.
2. Tag the new version, as in [step 2](#tag-version).
3. Click **Publish** on the new draft.

If [**New version**](#click-new-version) was not clicked, the deposit refuses and links to the paper's Zenodo record.

## Leaving files out of the deposit

`source.zip` holds what is committed at the tag. To leave a committed folder out, such as a large data set, mark it in `.gitattributes`:

```
data/ export-ignore
```

The PDF is rendered from the files in the repository, with notebook outputs as they were saved. All files the manuscript points to must stay: a figure's image, a notebook it embeds, a file it includes. Without it, the PDF in the deposit cannot be rendered again.

`export-ignore` also leaves the folder out of the source archives GitHub offers for download, such as **Download ZIP**. A clone still has it.

## When the publish run fails

The run opens an issue titled **Zenodo publish failed for** the tag, labelled `zenodo-publish-failed`, with the reason. A common one is a new version tagged before **New version** was clicked on Zenodo. Fix the cause, then open the failed run and click **Re-run failed jobs**.

(from-terminal)=
## Publishing from the terminal

Setting the Zenodo tokens on GitHub is optional ([why a journal may leave them unset](../reference/secrets.md)). Without them, an editor runs the Zenodo steps from a clone of the paper repository. Without a token, **Deposit version** still builds the tag and ends with a notice saying to deposit from the terminal, and **Reserve DOI** fails, pointing at `oak deposit prepare`.

This needs `oak`, [gh](https://cli.github.com) logged in (`gh auth login`) as an editor of the paper repository, and a Zenodo token in `ZENODO_TOKEN`, or in `ZENODO_TOKEN_SANDBOX` for the [sandbox](#sandbox)[^zenodo-secrets-create]. `oak deposit` and `oak release` run the `oak` version the paper's `myst.yml` names, as [`oak build` does](pins.md#pins-local). When that version is too old to deposit from the terminal, they say so: [upgrade the paper](pins.md) and tag again.

[^zenodo-secrets-create]: See [secrets](../reference/secrets.md) for how to create tokens.

(publish-without-review)=
### Publishing without review

`oak release --publish-without-review` publishes the draft as soon as it is filled, so the version gets its DOI with no check on Zenodo first. Once it is published, Zenodo does not let its files change.

(sandbox)=
:::{dropdown} Testing on the Zenodo sandbox
With **Use the Zenodo sandbox** ticked, the DOI is a sandbox one (`10.5072/zenodo.…`), and tags deposit on [sandbox.zenodo.org](https://sandbox.zenodo.org) with `ZENODO_TOKEN_SANDBOX`. A sandbox DOI never resolves, and the journal website leaves out a paper that has one. A paper with no DOI yet is listed.

To move to the real Zenodo, run **Reserve DOI** again with the box unticked. Its pull request replaces the sandbox DOI with a real one.
:::
