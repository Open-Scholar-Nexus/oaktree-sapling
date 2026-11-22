(ref-check-files)=
# Check files

A check file is a JavaScript module in the journal repository that `journal.yml` lists under `checks:` by its path ([how to write one](../guide/checks.md#journal-checks)). Its default export has a `validate(paper, options)` function. `options` has the fields of the check's entry in `journal.yml`, except `optional`, `id` included.

(ref-check-files-results)=
## Results

`validate` returns a result, a list of results, or a promise of either. An empty list adds no row. A result is a [Curvenote](https://www.npmjs.com/package/@curvenote/check-definitions) `CheckResult`, and oak reads these of its fields:

| field | |
|---|---|
| `status` | `pass`, `fail` or `error`. Required. |
| `message` | The text of the row. Required. |
| `help` | How to fix it, added to the annotation. |
| `file` | The page, as `paper.pages[].file`. |
| `position` | Where in the page, as a node's `position`. With `file`, the message shows on that line of the pull request's diff. |
| `optional` | `true` makes this result a warning. |

(ref-check-files-paper)=
## `paper`

Its types in oak's source are [`PaperData` and `Paper`](src:src/journal-checks.ts@PaperData).

| field | |
|---|---|
| `root` | The paper's folder, an absolute path. |
| `project` | The project frontmatter, such as `title`, `authors` and `keywords`, with the journal's settings merged in. |
| `config` | The paper's `myst.yml` as the author wrote it, without the journal's settings. |
| `repo` | The paper's repository, as `owner/name`, or `null` when oak cannot tell. On your machine it comes from [`--repo`](cli.md#validate), else the clone's `origin`. In the pull request checks it is the paper's repository, also for a pull request from a fork. |
| `journal` | The journal repository the check file comes from: `config`, its `journal.yml` with oak's defaults filled in, and `registry`, the entries of `registry/papers.yml` that oak accepts, or an empty list when it has none. |
| `projectParts` | The content of each part the project frontmatter sets, as a tree, by part name. |
| `pages` | One entry per page, in table-of-contents order and starting with the root page, which Curvenote's checks read as the article. See [pages](#ref-check-files-pages). |
| `toText(node)` | The text of a node and everything under it. |
| `selectAll(selector, node)` | The nodes under `node` that match a selector such as `'heading'`, from [`unist-util-select`](https://github.com/syntax-tree/unist-util-select). |
| `positionOf(node)` | A `position` for a result about `node`: the node's own. A node a directive makes, such as a figure or an `{image}`, has none, so it gets the first line of the nearest node before it on its page that has one. `undefined` for a node in no page's `mdast`. |

oak adds fields to `paper` and never renames or removes one.

(ref-check-files-pages)=
### Pages

Each entry of `paper.pages` has these fields. Its type in oak's source is [`PaperPage`](src:src/journal-checks.ts@PaperPage).

| field | |
|---|---|
| `file` | The page's file, an absolute path. |
| `frontmatter` | Its frontmatter as MyST reads it ([frontmatter](#ref-check-files-frontmatter)). |
| `fileFrontmatter` | The frontmatter block at the top of its file, as written. It is `{}` when the page has none, and `null` when the block is not a YAML mapping or the page is not a `.md` file. List MyST's `frontmatter-is-yaml` rule to block a page whose block is not valid YAML. |
| `mdast` | Its content, as a tree. |
| `parts` | The content of each part its frontmatter sets, as a tree, by part name. |

The tree follows [MyST's document structure](https://mystmd.org/spec), from the MyST version in the paper's oak.

(ref-check-files-frontmatter)=
## Frontmatter

A paper's metadata comes from `myst.yml` and from the block at the top of each page, and `paper` shows each in two forms:

- `config` is `myst.yml` as written. `project` is its `project:` section with the journal's settings merged in.
- A page's `fileFrontmatter` is its block as written. Its `frontmatter` is that block as MyST reads it: MyST drops the keys it does not know, fills in the fields the page does not set, such as `authors` and `keywords`, from the project frontmatter, and takes the `title` from a first `# Heading`.

Some frontmatter keys are content, not settings: `abstract:`, `data_availability:`, `acknowledgments:` and the other parts. MyST moves each into a part of its own, and leaves only a pointer to it in `project.parts` or the page's `frontmatter.parts`. The part's content is in `projectParts` when `myst.yml` sets it, and in the page's `parts` when the page does. A part's `position` counts lines from the start of the part's own text, not of the file. A `+++ {"part": "abstract"}` block in a page's body stays in `mdast`, as a `block` node with `data.part` set to `abstract`.

(ref-check-files-running)=
## Where a check runs

A check runs inside `oak validate`, with the paper's folder as its working directory. It can read the paper's files under `paper.root` and use `fetch`. It also sees the environment `oak validate` runs in, which differs between your machine and the pull request checks, so read the repository from `paper.repo`.

A check file can import Node's built-in modules, such as `node:path`, and other files in the journal repository. CI clones the journal repository without installing anything, so an import of a package fails there, even when it works on your machine.

(check-time-limit)=
oak waits up to two minutes for each check file. A check file still running then, such as one whose `fetch` waits on a server that does not answer, shows as an `error` row, and oak moves on to the next check.
