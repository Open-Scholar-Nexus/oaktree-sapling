(guide-checks)=
# Editorial checks

The editorial checks are the requirements a paper has to meet before its pull request can merge, such as having an abstract or an ORCID for every author. The journal lists them under `checks` in `journal.yml`, and every pull request to a paper runs them, posting the result as a comment and as the **Journal checks** status. oak adds checks of its own on every paper: a wrong [paper id](journal-yml.md#id-pattern) or a missing `index.md` or `myst.yml` blocks the merge too, and a missing thumbnail or logo file shows a warning.

A new journal starts with:

```yaml
checks:
- id: authors-exist
- id: authors-have-orcid
- id: authors-have-credit-roles
- id: abstract-exists
- id: keywords-defined
```

A failing check blocks the merge. A check marked `optional: true` shows its result as a warning and does not block.

(changing-the-set)=
## Changing the set

Add, remove or edit entries under `checks`, then push the journal repository. Each entry is a check's `id`, plus `optional: true` and the check's options where it has them:

```yaml
checks:
- id: word-count
  max: 6000
- id: data-availability-exists
  optional: true
```

The checks are [Curvenote](https://curvenote.com)'s, from its open-source [`@curvenote/check-implementations`](https://www.npmjs.com/package/@curvenote/check-implementations):

| id | requires | options, with their defaults |
|---|---|---|
| `abstract-exists` | an abstract | |
| `abstract-length` | an abstract of at most `max` words | `max: 400` |
| `authors-exist` | at least one author | |
| `authors-corresponding` | a corresponding author | |
| `authors-have-affiliations` | an affiliation for every author | |
| `authors-have-orcid` | an ORCID for every author | |
| `authors-have-credit-roles` | at least one CRediT role for every author | |
| `data-availability-exists` | a data availability statement | |
| `keywords-defined` | keywords | |
| `keywords-length` | at most `max` keywords | `max: 5` |
| `keywords-unique` | no repeated keyword | |
| `links-resolve` | every external link to resolve | |
| `doi-exists` | a valid DOI for every citation | |
| `word-count` | a body of `min` to `max` words | `max: 3500`, `min: 0`, `figures: false` and `footnotes: false` (count captions and footnotes), `part` (count a part such as the abstract instead) |
| `figure-count` | `min` to `max` figures, tables and other numbered blocks | `max: 100`, `min: 0`, `kind` (count one kind only, such as `figure` or `table`) |
| `exports-exist` | the PDF to be built | |

`exports-exist` needs a built PDF, which the Journal checks do not make, so it reports that it could not run and never blocks.

Any of MyST's own [build rules](https://github.com/jupyter-book/mystmd/blob/main/packages/myst-common/src/ruleids.ts) can be listed too, such as `math-renders` or `image-exists`: the check fails when the build warns under that rule.

An id that is not a check fails, with a link to this section.

(validate-runs-paper-code)=
## `oak validate` runs the paper's code

`oak validate`, `oak build` and `oak start` load the MyST plugins a paper lists under `project.plugins` in its `myst.yml`. A plugin is JavaScript, and it runs on your machine with your permissions. Before running `oak` on a submission, read the plugins its `myst.yml` lists.
