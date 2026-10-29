(ref-secrets)=
# Secrets

Draft deposits on Zenodo and live previews of pull requests on Cloudflare need tokens that identify the journal to each service.[^danger-tokens] A paper repository keeps its tokens as secrets on GitHub environments. Each environment is open only to the branch or tag whose workflow reads its secrets. GitHub needs no secret of its own: workflows use the token GitHub gives each run, and `oak` run locally acts as the account logged in to `gh` (see [Create a journal](../start/setup.md)).

`ZENODO_TOKEN`, `ZENODO_TOKEN_SANDBOX`
: Used to reserve a DOI and to upload published versions to drafts. `ZENODO_TOKEN` works on Zenodo, `ZENODO_TOKEN_SANDBOX` is an optional token you can use on the Zenodo sandbox for tests. Create each under **Applications** in the account settings on [Zenodo](https://zenodo.org/account/settings/applications/) or the [sandbox](https://sandbox.zenodo.org/account/settings/applications/), with the `deposit:write` scope only. Held by the `zenodo-prepare` (for `main`) and `zenodo-publish` (for `v*` tags) environments. Set with `--zenodo-token` and `--zenodo-token-sandbox`.

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
: Used to give each pull request a live preview link, once the journal also [turns previews on](../guide/journal-yml.md#live-previews). Until then, a pull request gets a downloadable copy of the built site. The token needs permission to edit Cloudflare Pages. Held by the `preview` environment (for `main`). Set with `--cf-token` and `--cf-account`.

`oak bootstrap paper` sets each secret it is given on the environments that hold it. Pass each as its flag, or set an environment variable with the secret's name before running it. When it finishes, `oak` lists the secrets still missing and links to the repository's environment settings, where you can set them.

[^danger-tokens]: Oaktree Sapling sets up the paper repository so that authors cannot read its tokens, even with push access ([how](../design/paper-ci.md)). It cannot stop an editor from merging a workflow change that exposes them, so whenever a pull request changes a file listed in `CODEOWNERS`, you must carefully review it.

