# scholar nexus

This repo contains the public development for a prototype of an open, easy-to-setup, free science dissemination platform.
Do not expect stability or extensive documentation until the project will consolidate.

## run this locally

1. clone this repo and open it in vscode
1. click the popup or search for the action "build and reopen in container" (ctrl+shift+p->reopen) 
1. open a terminal
1. run `python build_toc.py` to clone content and generate `_toc.yml`
1. run `HOST=0.0.0.0 myst start --keep-host`

## access the live preview

TODO!

## dev

### why devcontainers

To absolutely 100% ensure replicability of environment, we currently use devcontainers for our dev environment. The environment is fully contained in `.devcontainer/environment.yml`, so the container just installs micromamba (a smaller conda alternative) and creates a suitable environment. Devcontainers ensures:
1. complete replicability on environment
1. same "base" development experience
1. one-action onboarding experience

### what the workflow is right now

- `journal.yml` contains a list of repositories and their main entrypoint MystMD file
- `build_toc.py` takes this list and turns it into a table of contents (`_toc.yml`) suitable for myst to generate a website from
- `myst start` converts markdown to HTML+JS, watches files for hot reloading and serves the website

### where to find more info

Most of the work will follow our issue board. This work is funded by Neuromatch! More info [here](https://neuromatch.io/about/)