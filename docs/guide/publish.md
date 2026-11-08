(guide-publish)=
# Publish a paper on Zenodo

Oaktree Sapling supports creating drafts on Zenodo. Publishing a paper on Zenodo also gives it a DOI. An editor does it once `main` holds the paper as it should be published, and again for each [new version](#new-version). Since the paper's `myst.yml` needs to contain the DOI assigned by Zenodo, publishing the first version has a preliminary step called "reserving the DOI". 

Oaktree Sapling can publish with one command run on an editor's computer, or with workflows on GitHub. The workflows need the paper repository to have access to [Zenodo tokens](../reference/secrets.md); the command keeps the token on the editor's computer[^current-security].

[^current-security]: Until Zenodo handles token scopes correctly, we recommend publishing from the terminal ([why](../reference/secrets.md)).

(from-terminal)=
## Publishing from the terminal

This needs `oak`, [gh](https://cli.github.com) logged in (`gh auth login`) as an editor of the paper repository, and a Zenodo token[^zenodo-secrets-create], set as the environment variable `ZENODO_TOKEN` in the shell you run oak from (`export ZENODO_TOKEN=<token>`) or passed with `--token <token>`. Then run:

```bash
oak release --repo owner/paper-repo v1.0.0
```

When run inside a clone of the paper repository, `--repo` can be left out. `v1.0.0` is the version, in the form `vMAJOR.MINOR.PATCH`, and becomes the tag; without it, oak lists the repository's tags.

oak lists what it will do on GitHub and Zenodo and asks once (`--yes` skips the confirmation prompt). When publishing the first version, it:

1. reserves the DOI: it creates an empty draft on Zenodo and opens a pull request, **Reserve Zenodo DOI**, that writes the DOI into `myst.yml`[^concept-vs-version-doi];
2. skips that pull request's **Journal checks** ([why](#design-paper-ci-limits)) and merges it;
3. tags the merge commit with the version, which starts the **Deposit version** workflow;
4. waits for that workflow to build the paper, which can take several minutes;
5. fills the Zenodo draft with the build ([what a deposit carries](#design-releases-deposit)), attaches the same files to the tag's GitHub release, and prints the draft's URL, which it also comments on the tagged commit.

You then [publish the draft on Zenodo](#publish-on-zenodo) and [list the paper on the journal website](#list-on-site).

oak works in a clone in a temporary folder. The clone is removed when the release is done; if the release fails or you interrupt it with Ctrl-C, the clone is kept, and oak prints where; [`oak clean`](#clean) lists and removes kept clones. If it stops for any reason (a wait that took too long, Ctrl-C, a failed step), you can run the same command again: it reads from GitHub and Zenodo what is already done and continues from there.

`oak release` runs its subcommands (the ones that use the Zenodo token) with the `oak` version the paper's `myst.yml` names, as [`oak build` does](pins.md#pins-local).

[^zenodo-secrets-create]: See [secrets](../reference/secrets.md) for how to create tokens.

[^concept-vs-version-doi]: The reserved DOI is the paper's concept DOI: one DOI for all its versions, which resolves to the newest. Each version also gets a DOI of its own when its draft is published on Zenodo, and that one always resolves to that version.

(publish-without-review)=
### Publishing without review

`oak release --publish-without-review` publishes the draft as soon as it is filled, so the version gets its DOI with no check on Zenodo first. Once it is published, Zenodo does not let its files change.

(publish-on-zenodo)=
## Publish on Zenodo

Open the draft on Zenodo, check it, and click **Publish**. The DOI resolves from then on.

(list-on-site)=
## List it on the journal website

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
2. Run `oak release` with the new version, such as `oak release v1.1.0`. oak tags the newest commit of `main`, which the confirmation names, and deposits it. With the GitHub workflows, [tag the version](#tag-version) instead.
3. Click **Publish** on the new draft.

If [**New version**](#click-new-version) was not clicked, oak refuses before it creates the tag, and links to the paper's Zenodo record.

## With the GitHub workflows

The same steps, run one at a time with the paper repository's workflows. Without Zenodo tokens on GitHub, **Reserve DOI** fails, pointing at the terminal, and **Deposit version** builds the tag and ends with a notice.

### 1. Reserve the DOI

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

The run creates an empty draft on Zenodo to reserve a DOI and opens the pull request **Reserve Zenodo DOI**, for you to merge; its Journal checks are skipped ([why](#design-paper-ci-limits)). `oak release reserve-doi`, in a clone, does the same from the terminal.

(tag-version)=
### 2. Tag the version

Once the pull request is merged, tag `main` with a version number in the form `vMAJOR.MINOR.PATCH`, and push the tag:

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

The tag starts the **Deposit version** workflow, which builds the paper and, with Zenodo tokens set, fills the draft, attaches the files to the tag's GitHub release and comments the draft's address on the tagged commit. Without Zenodo tokens on GitHub, run `oak release --repo owner/paper-repo v1.0.0` [from the terminal](#from-terminal), with your token: it finds the tag already there, waits for that build, and deposits it. Then [publish the draft](#publish-on-zenodo).

## Leaving files out of the deposit

`source.zip` holds what is committed at the tag. To leave a committed folder out, such as a large data set, mark it in `.gitattributes`:

```
data/ export-ignore
```

The PDF is rendered from the files in the repository, with notebook outputs as they were saved. All files the manuscript points to must stay: a figure's image, a notebook it embeds, a file it includes. Without it, the PDF in the deposit cannot be rendered again.

`export-ignore` also leaves the folder out of the source archives GitHub offers for download, such as **Download ZIP**. A clone still has it.

## When the publish run fails

The run opens an issue titled **Zenodo publish failed for** the tag, labelled `zenodo-publish-failed`, with the reason. A common one is a new version tagged before **New version** was clicked on Zenodo. Fix the cause, then open the failed run and click **Re-run failed jobs**.

(sandbox)=
:::{dropdown} Testing on the Zenodo sandbox
With `oak release --sandbox`, or **Use the Zenodo sandbox** ticked, the DOI is a sandbox one (`10.5072/zenodo.…`), and tags deposit on [sandbox.zenodo.org](https://sandbox.zenodo.org) with `ZENODO_TOKEN_SANDBOX` (from the terminal, the environment variable of that name). Once a sandbox DOI is on `main`, every release deposits on the sandbox, with or without `--sandbox`. A sandbox DOI never resolves, and the journal website leaves out a paper that has one. A paper with no DOI yet is listed.

To move to the real Zenodo, run **Reserve DOI** again with the box unticked, or `oak release reserve-doi` in a clone. Its pull request replaces the sandbox DOI with a real one.
:::
