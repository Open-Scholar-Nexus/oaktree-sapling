(add-paper)=
# Add a paper

Each submission gets a repository of its own, created by an editor with `oak bootstrap paper`. The author works in that repository, and its workflows build, check and publish the paper with the journal's settings. Draft deposits on Zenodo and live previews of pull requests need tokens, set when the repository is created (see [Secrets](#paper-secrets)).

## Create the repository

For a new paper, starting from the starter manuscript:

```bash
oak bootstrap paper --repo <owner>/<paper-repo> \
  --instance <owner>/<journal-repo> \
  --edition 2026
```

For a paper the author already wrote in a repository of their own:

```bash
oak bootstrap paper --repo <owner>/<paper-repo> \
  --instance <owner>/<journal-repo> \
  --edition 2026 \
  --from https://github.com/<author>/<their-repo>
```

`--instance` names the journal repository and `--edition` one of its editions, as named by a file in its `editions/` folder. Both are required: they are written into the paper repository, and every build reads the journal's settings through them.

On an organisation, add `--owner @<org>/<team>` so the editors team owns the repository's workflows and settings (see [Create a journal](../start/setup.md)). On a personal account the owner is you.

As with the journal, `oak` prints a plan, including every default it took, and asks before changing anything. Running the same command again finishes a run that failed partway.

## What it sets up

- A public repository with the starter manuscript and the workflows that build and check it. `--private` makes it private, but on GitHub's free plan a private repository gets neither branch rules nor Pages, and the journal website cannot show it.
- Branch rules: changes to `main` need a pull request that passes the Journal checks and is approved by a code owner, and only editors can create the `v*` tags that publish a version. `--no-require-checks` leaves the Journal checks out of the rule.
- GitHub Pages for the paper's website, linked from the repository page.
- Environments that keep each secret to the branch or tag that needs it: `zenodo-prepare` and `preview` for `main`, `zenodo-publish` for `v*` tags.
- Permission for the workflows to open pull requests, which they use to write the paper's DOI into `myst.yml`.

(paper-secrets)=
## Secrets

Draft deposits on Zenodo and live previews of pull requests need tokens, set on the paper repository's environments:

`ZENODO_TOKEN`, `ZENODO_TOKEN_SANDBOX`
: Used to create the paper's draft on Zenodo. Create each under **Applications** in the account settings on [Zenodo](https://zenodo.org/account/settings/applications/) or the [sandbox](https://sandbox.zenodo.org/account/settings/applications/), with the `deposit:write` scope only (see [Publish a paper](publish.md)).

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
: Each pull request gets a live preview link, once the journal also [turns previews on](journal-yml.md#live-previews). Until both are set, a pull request gets a downloadable copy of the built site.

Pass them to `oak bootstrap paper` as `--zenodo-token`, `--zenodo-token-sandbox`, `--cf-token` and `--cf-account`, or set the environment variables of the same names before running it. `oak` lists any that are still missing when it finishes, with the page to set them on.

## The author's first steps

`oak bootstrap paper` ends by listing what is left to do:

- **A new paper.** The starter `myst.yml` still has the placeholder id. The author fills in `project.id`, in the shape the journal's `id_pattern` asks for, plus the title and the authors, in a pull request. Until the id is set, the Journal checks fail and the paper's website is not deployed.
- **A paper imported with `--from`.** The author's files are copied onto a branch called `review`, with `.github/` and `CODEOWNERS` taken from `main` in place of the author's, and `oak` opens a pull request from it. The author's own `myst.yml` replaces the starter one, so the pull request has to add the engine version and edition under `project.options.oaktree-sapling` before it builds; copy them from `myst.yml` on `main`.

Authors work from a fork of the paper repository and open pull requests from it. The first time someone does, GitHub asks an editor to approve the workflow run, once per new contributor, in the repository's **Actions** tab. To give an author push access instead, `oak` prints the command; they can then push branches, but `main` still needs a pull request and only editors can create `v*` tags.

What the author sees is described in [Your paper repository](../start/paper.md).
