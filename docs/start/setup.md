(start-setup)=
# Create a journal

## Before you start

`oak` needs Node 22 or later and the GitHub CLI, logged in to the account that will own the repositories:

```bash
gh auth login
```

`oak bootstrap` checks for `gh` and a logged-in account before it does anything else.

The command below runs `oak` with `npx`, without installing it. To create papers as well, install it with `npm install -g oaktree-sapling` and type `oak` in place of `npx oaktree-sapling@latest`, as the other pages do.

## Choose where the repositories live

A journal is a set of repositories under one GitHub account: one for the journal's settings and website, then one per paper. The account can be your own or an organisation.

On a personal account you are the only editor. On an organisation, the editors are a team. To run the journal from an organisation, create these before bootstrapping:

- the organisation;
- a team for the editors (for example `@my-journal/editors`). Its members can be added later, but a paper's pull requests cannot merge and its versions cannot be tagged until the team has at least one;

and check that the account running `oak` can create repositories in the organisation and administer them, since `oak bootstrap` sets rules and environments on each one.

Then pass the team with `--owner @my-journal/editors` when you create each paper repository. The team gets write access, owns the repository's workflows and settings in `CODEOWNERS`, and is the only one allowed to create the tags that publish a version. `--owner` applies to paper repositories only: the journal repository belongs to the account that created it, and editors who should change the journal's settings need access to it granted on GitHub.

## Create the journal

```bash
npx oaktree-sapling@latest bootstrap journal --repo <owner>/<journal-repo> \
  --name "My Journal" \
  --edition 2026
```

`oak` prints what it is about to do, including every value it took a default for, and asks before changing anything. `--edition` names the first edition; without it the edition is called `seedling`. The engine version defaults to the version of the `oak` you run, and the plan says when a newer release exists; `--engine-version <tag>` pins another, with the files still coming from the `oak` you run. An `oak` that is not a stable release needs `--engine-version`.

Running the same command again finishes a run that failed partway and skips what is already there. It does not rewrite files already on `main`, so a different `--name` or `--edition` on a second run changes nothing: edit the files instead.

Then go on to [what bootstrap made](journal.md).
