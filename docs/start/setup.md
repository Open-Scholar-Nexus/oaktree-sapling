(start-setup)=
# Before you start

## Install

`oak` needs Node 22 or later and the GitHub CLI, logged in to the account that will own the repositories:

```bash
npm install -g oaktree-sapling
gh auth login
```

`oak bootstrap` checks for `gh` and a logged-in account before it does anything else.

## Choose where the repositories live

A journal is a set of repositories under one GitHub account: one for the journal's settings and website, then one per paper. The account can be your own or an organisation.

On a personal account you are the only editor. Paper repositories let you merge your own pull requests and create the tags that publish a version.

On an organisation, the editors are a team. Before bootstrapping, create:

- the organisation;
- a team for the editors, with its members (for example `@my-journal/editors`);

and check that the account running `oak` can create repositories in the organisation and administer them, since `oak bootstrap` sets rules and environments on each one.

Then pass the team with `--owner @my-journal/editors` when you create each paper repository. The team gets write access, owns the repository's workflows and settings in `CODEOWNERS`, and is the only one allowed to create the tags that publish a version. The journal repository itself needs no owner.

## Create the journal

```bash
oak bootstrap journal --repo <owner>/<journal-repo> --external --name "My Journal" --edition 2026
```

`oak` prints what it is about to do, including every value it took a default for, and asks before changing anything. `--edition` names the first edition; without it the edition is called `edition`. The engine version defaults to the newest stable release.

Running the same command again finishes a run that failed partway and skips what is already there. It does not rewrite files already on `main`, so a different `--name` or `--edition` on a second run changes nothing: edit the files instead.

Then go on to [what bootstrap made](journal.md).
