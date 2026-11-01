(guide-publish)=
# Publish a paper on Zenodo

Oaktree Sapling supports creating drafts on Zenodo. Publishing a paper on Zenodo also gives it a DOI. An editor does it once `main` holds the paper as it should be published, and again for each [new version](#new-version). Since the paper's `myst.yml` needs to contain the DOI assigned by Zenodo, publishing the first version has a preliminary step called "reserving the DOI". 

Oaktree Sapling can publish either with a workflow on GitHub, or with a command run locally. To use the GitHub workflow, the paper repository must have access to [Zenodo tokens](../reference/secrets.md). Alternatively, an editor can run the same steps [from the terminal](#from-terminal)[^current-security].

[^current-security]: Until Zenodo handles token scopes correctly, we recommend publishing from the terminal ([why](../reference/secrets.md)).

## 1. Reserve the DOI

Run the paper repository's **Reserve DOI** workflow:

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
::::

The run creates an empty draft on Zenodo to reserve a DOI and opens a pull request, **Reserve Zenodo DOI**, that writes the DOI into `myst.yml`, for you to merge.[^bot-pr-checks] Once main's `myst.yml` contains the reserved DOI, you're ready to fill the draft[^concept-vs-version-doi].

[^bot-pr-checks]: GitHub holds the checks on a pull request a workflow opens, and approving them does not start them. Merging needs the **Journal checks** to pass, so close and reopen the pull request to run them.

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

Without Zenodo tokens on GitHub, the workflow ends with a notice. Once it has finished, run [`oak release`](#from-terminal) from a clone of the paper repository, which deposits that build in the same way.

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

The Zenodo tokens are optional on GitHub ([why a journal may leave them unset](../reference/secrets.md)). Without them, an editor runs the Zenodo steps from a clone of the paper repository. Without a token, **Deposit version** still builds the tag and ends with a notice saying to deposit from the terminal, and **Reserve DOI** fails, pointing at `oak deposit prepare`.

This needs `oak`, [gh](https://cli.github.com) logged in (`gh auth login`) as an editor of the paper repository, and a Zenodo token in `ZENODO_TOKEN`, or in `ZENODO_TOKEN_SANDBOX` for the [sandbox](#sandbox). Create it under **Applications** in the account settings on [Zenodo](https://zenodo.org/account/settings/applications/) or the [sandbox](https://sandbox.zenodo.org/account/settings/applications/). `oak deposit` and `oak release` run the `oak` version the paper's `myst.yml` names, as [`oak build` does](pins.md#pins-local). When that version is too old to deposit from the terminal, they say so: [upgrade the paper](pins.md) and tag again.

To reserve the DOI, in the clone, on an up-to-date `main`:

```bash
git switch main
git pull
oak deposit prepare
```

It creates a draft on Zenodo and opens the **Reserve Zenodo DOI** pull request. `--sandbox` reserves the DOI on the sandbox.

To fill the draft, [tag the version](#tag-version) as usual. Once its **Deposit version** run has built it, check out the tag and run `oak release`:

```bash
VERSION=v1.0.0
git fetch --tags
git checkout "$VERSION"
oak release --tag "$VERSION"
```

`oak release` downloads the build of that run, after checking that the run is the push of that tag at the tag's commit. It uploads the same files the workflow does, also left in `_build/bundle`, attaches them to the tag's GitHub release, and comments the draft's address on the tagged commit. The clone has to be at the tag, with no changes to tracked files, since the deposit archives the commit checked out and reads `myst.yml` from the working tree. Then [publish on Zenodo](#publish-on-zenodo) as usual. For a [new version](#new-version), run `oak release` for its tag after pushing it.

`oak release` refuses while the run is still building, when the build failed, and when the run has no build job or its build lacks a file the deposit needs, with a link to the run. When Zenodo refuses, it prints the reason.

(local-build)=
### Building on your computer

To deposit a build made on your computer, build at the tag in a shell without the Zenodo token, then deposit it with `--use-local-build`:

```bash
VERSION=v1.0.0
git checkout "$VERSION"
oak build
oak release --tag "$VERSION" --use-local-build
```

The build runs the paper's code with your permissions: MyST loads the plugins the paper's `myst.yml` lists, as JavaScript. [Read them](checks.md#validate-runs-paper-code) before building. Set up any environment `paper-environment.yml` describes yourself, since installing it runs package scripts. Building in a shell without the token keeps the token out of the environment the paper's code runs in.

`oak release` refuses a build whose PDF or pages are older than the tag's commit, as a build left from an earlier tag is. Delete `_build` and build again. The deposit's provenance records your computer's platform and the typst on your `PATH`. The engine's typst is built for Linux on x86_64, so on another machine, such as a Mac or an arm64 computer, the PDF comes from your own typst and can differ from the CI build.

(publish-without-review)=
### Publishing without review

`oak release --publish-without-review` publishes the draft as soon as it is filled, so the version gets its DOI with no check on Zenodo first. Once it is published, Zenodo does not let its files change.

(sandbox)=
:::{dropdown} Testing on the Zenodo sandbox
With **Use the Zenodo sandbox** ticked, the DOI is a sandbox one (`10.5072/zenodo.…`), and tags deposit on [sandbox.zenodo.org](https://sandbox.zenodo.org) with `ZENODO_TOKEN_SANDBOX`. A sandbox DOI never resolves, and the journal website leaves out a paper that has one. A paper with no DOI yet is listed.

To move to the real Zenodo, run **Reserve DOI** again with the box unticked. Its pull request replaces the sandbox DOI with a real one.
:::
