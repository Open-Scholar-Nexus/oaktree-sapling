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

An id that is neither a check nor the path of a [check file](#journal-checks) fails, with a link to this section.

(journal-checks)=
## The journal's own checks

A journal can write a check as a JavaScript file in the journal repository and list it by its path:

```yaml
checks:
- id: authors-exist
- id: ./checks/pseudo-headings.mjs
- id: ./checks/word-limit.mjs
  max: 300
  optional: true
```

The path starts with `./`, is relative to the root of the journal repository, stays inside it, and ends in `.mjs`. `checks/` is the usual folder. The path names the check's row in the report, so renaming the file renames the row. The entry's other fields, except `optional`, reach the check as its options.

oak runs check files from v0.3.0. A paper pinned to an older version reports the path as an unknown check id, which blocks its merge, so list a new check file as `optional: true` until the journal's papers have [moved to that version](pins.md).

### Writing a check file

The file's default export has a `validate(paper, options)` function. This one finds a bold or italic line used as a heading:

```js
// A bold or italic line on its own is a paragraph to MyST: no number, no contents entry, no link target.
export default {
  validate(paper) {
    const found = [];
    for (const page of paper.pages) {
      // Top-level paragraphs only, so a bold caption or table cell is left alone.
      const top = page.mdast.children.flatMap((n) => (n.type === 'block' ? n.children : [n]));
      for (const p of top.filter((n) => n.type === 'paragraph')) {
        const parts = p.children.filter((c) => c.type !== 'text' || c.value.trim());
        if (parts.length === 1 && ['strong', 'emphasis'].includes(parts[0].type)) {
          found.push({
            status: 'fail',
            message: `"${paper.toText(p)}" is styled as a heading`,
            help: 'Make it a heading (## ...) or part of the text',
            file: page.file,
            position: p.position,
          });
        }
      }
    }
    return found.length
      ? found
      : { status: 'pass', message: 'No bold or italic lines used as headings' };
  },
};
```

`validate` returns a result, a list of results, or a promise of either. An empty list adds no row. A result has these fields:

| field | |
|---|---|
| `status` | `pass`, `fail` or `error`. Required. |
| `message` | The text of the row. Required. |
| `help` | How to fix it, added to the annotation. |
| `file` | The page, as `paper.pages[].file`. |
| `position` | Where in the page, as a node's `position`. With `file`, the message shows on that line of the pull request's diff. |
| `optional` | `true` makes this result a warning. |

`paper` holds the paper as MyST processed it:

| field | |
|---|---|
| `root` | The paper's folder, an absolute path. |
| `project` | The project frontmatter, such as `title`, `authors` and `keywords`. |
| `pages` | One `{ file, frontmatter, mdast }` per page in the table of contents, `index.md` first: its absolute path, its own frontmatter, and its content as a tree. |
| `toText(node)` | The text of a node and everything under it. |
| `selectAll(selector, node)` | The nodes under `node` that match a selector such as `'heading'`, from [`unist-util-select`](https://github.com/syntax-tree/unist-util-select). |

MyST moves an `abstract:` to `parts.abstract`: of `project` when `myst.yml` sets it, of the page's `frontmatter` when the page does. A `+++ {"part": "abstract"}` block stays in `mdast`, as a `block` node with `data.part` set to `abstract`.

The tree follows [MyST's document structure](https://mystmd.org/spec), from the MyST version in the paper's oak, so a MyST upgrade in oak can change the shape of a node. oak adds fields to `paper` and never renames or removes one. Each check gets its own copy of `project` and `pages`, so a check that changes them leaves the next one unaffected.

A check file can import Node's built-in modules, such as `node:path`, and other files in the journal repository. CI clones the journal repository without installing anything, so an import of a package fails there, even when it works on your machine.

### Testing a check file

From a clone of any paper, run `oak validate` against your copy of the journal repository ([previewing with other settings](journal-settings.md#previewing-with-other-settings)):

```bash
oak validate --instance ../<journal-repo>
```

It runs the journal's checks, check files included, as they are on disk, uncommitted edits too, and reads them again on every run. `oak validate` runs the version of oak the paper pins, so the paper must pin one that runs check files.

### When a check file breaks

A check file that is missing, does not load, has no `validate`, throws, or returns a result oak cannot read shows one `error` row under its path, with the reason and a link to this section. It blocks the merge unless the entry is `optional: true`, and the other checks still run. A check file pushed to the journal repository runs on every open paper pull request's next run, so try it with `oak validate` first.

(validate-runs-paper-code)=
## `oak validate` runs the paper's code

`oak validate`, `oak build` and `oak start` load the MyST plugins a paper lists under `project.plugins` in its `myst.yml`. A plugin is JavaScript, and it runs on your machine with your permissions. Before running `oak` on a submission, read the plugins its `myst.yml` lists.

`oak validate` also runs the journal's [check files](#journal-checks), from the journal repository `pins.yml` names or the folder `--instance` names.
