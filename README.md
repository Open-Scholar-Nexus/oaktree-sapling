# scholar nexus

This repo contains the public development for a prototype of an open, easy-to-setup, free science dissemination platform.
Do not expect stability or extensive documentation until the project will consolidate.

**Live site:** https://open-scholar-nexus.github.io/oaktree-sapling/

The site is automatically deployed to GitHub Pages on every push to the main branch.

## run this locally

1. Clone this repo
2. Create the environment from the environment file: `mamba env create -f .devcontainer/environment.yml`
3. Activate the environment: `mamba activate nexus`
4. Run `myst start` to start the local development server

## dev

### what the workflow is right now

- `papers.txt` contains a list of paper repository names (organized by year)
- MyST builds the site from the source files
- you can check html builds by serving them with `npx serve _build/html`
- GitHub Actions builds and deploys to GitHub Pages on push to main

### where to find more info

Most of the work will follow our issue board. This work is funded by Neuromatch! More info [here](https://neuromatch.io/about/)