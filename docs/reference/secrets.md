(ref-secrets)=
# Secrets

A paper repository holds its tokens as secrets on GitHub environments, each open only to the branch or tag whose workflows use it. GitHub itself needs no secret: the workflows use the token GitHub gives each run, and `oak` acts as the account logged in to `gh` (see [Create a journal](../start/setup.md)).

`ZENODO_TOKEN`, `ZENODO_TOKEN_SANDBOX`
: Reserving a DOI and depositing each published version, on Zenodo or on the Zenodo sandbox for a test. Create each under **Applications** in the account settings on [Zenodo](https://zenodo.org/account/settings/applications/) or the [sandbox](https://sandbox.zenodo.org/account/settings/applications/), with the `deposit:write` scope only. Leave `deposit:actions` off: without it the workflows can create and fill drafts but not publish them or start a new version, so only an editor can, on Zenodo (see [Publish a paper](../guide/publish.md)). Held by the `zenodo-prepare` environment for `main` and the `zenodo-publish` environment for `v*` tags.

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
: A live preview link on each pull request, once the journal also [turns previews on](../guide/journal-yml.md#live-previews). Until then, a pull request gets a downloadable copy of the built site. The token needs permission to edit Cloudflare Pages. Held by the `preview` environment for `main`.

Pass them to `oak bootstrap paper` as `--zenodo-token`, `--zenodo-token-sandbox`, `--cf-token` and `--cf-account`, or set the environment variables of the same names before running it. `oak` lists any that are still missing when it finishes, with the page to set them on.
