# Writing

Prose rules, for the docs, code comments and anything else made of sentences. `STYLE.md` covers the code itself.

These are derived from edits to LLM drafts, not introspected: a pattern that shows up across several of those diffs lands here, and anything else is taste and stays out.

## What each section is for

| | reader | density |
|---|---|---|
| `docs/start/`, `docs/guide/` | a researcher who wants to publish and leave | task-shaped, no rationale |
| `docs/reference/` | someone looking a fact up | one home per fact, no narrative |
| `docs/design/` | a forker asking why it is shaped like this | mechanism and trade-off, the only place rationale belongs |

## Rules

### No em or en dashes

Use a period, semicolon, colon, comma or parentheses.

### British spelling

Colour, behaviour.

### Do not hard-wrap prose

A paragraph is one line. Not 80, not 95.

The wrap buys nothing rendered, and it makes every later edit a reflow, so a one-word change touches five lines and the real edit is invisible in the diff. Code, tables and genuinely short list items stay as they are.

### Do not assert importance

A clause whose content is *this matters* carries no information. Give the reason, or cut the clause.

```
Bad:   "This is the rule that is easiest to get wrong."
Good:  the rule, then what breaks when it is broken.
```

### Do not over-claim scope

State what the page covers, not what the reader needs.

```
Bad:   "everything you need to configure a journal"
Good:  "configuring journal.yml"
```

### Do not say it twice, once by negation

Keep the positive clause. The denial adds nothing.

```
Bad:   "This is not a build system, just a thin wrapper over mystmd."
Good:  "A thin wrapper over mystmd."
```

### Say what is there, not what is missing

Defining a thing by what it lacks costs the reader a question and answers none, because they have to picture the absent thing before the sentence is usable. Name what is there.

```
Check: a heading, or the sentence that opens a section, built on
       no / not / nothing / never. Report it; the author decides.
Bad:   "There is no central website"
Good:  "Repository layout"
Bad:   "A journal is not one repository."
Good:  "A journal is spread across repositories: one holding the settings
        every paper reads, and one per paper."
```

A negation earns its place when it corrects an assumption the reader is likely to arrive with, and it earns it by saying what happens instead: "There is no server: each paper's own CI does the work."

### Say it once, at the shortest length that still carries the mechanism

The failure is not long sentences, it is a point made three times: stated, restated as a summary, then again as a consequence. Keep the statement that carries the mechanism and delete the others. A bulleted list whose lead-in already said the same thing in prose is the common case.

### No fact that goes stale the moment something is added

Name the things, do not count them. The reader can see how many there are.

```
Bad:   "the four checks oak validate runs"
Good:  "the checks oak validate runs"
```

Dated liveness claims are the same defect. "Certified live 2026-09-05" is unfalsifiable as soon as whatever backed it is gone: state the rule, not the run.

### Do not cite what the reader cannot open

A pointer to a private notebook, a home directory or a repo nobody outside has access to is dead weight dressed as provenance. Carry the substance across, which is the claim plus its date, and drop the path.

### Describe the thing as it is, not relative to what it replaced

No "no longer", "used to", "replaces", "instead of", in prose or in comments: the reader never saw the earlier version, so the comparison costs them a question and answers none. The exception is a migration guide, where what changed is the subject.

The same goes for arguing with an alternative the reader never saw. A comment written right after a fix tends to defend the fix: "a finding that blocks, not just a note", "`config` rather than `structural`", "otherwise a broken paper would pass". State what the code does and the fact that makes it right. When an obvious simplification would break it, name that fact: "nothing else rejects a branch pin".

```
Check: "not just", "rather than", "otherwise" next to a design choice.
Bad:   "So it is a finding that blocks, not just a note: otherwise a paper
        whose build crashes would pass."
Good:  "A failed compose is the paper's own mistake, so it blocks the merge;
        having nothing to compose only adds a note."
```

### Do not carry old framing past the fact that produced it

A conclusion outlives the constraint it rested on and quietly becomes false. When a fact moves, grep for it before assuming one edit covers it, because it is usually written down in more than one place.

### Say it literally

No metaphor and no periphrasis: say what the thing does, in the words a reader would use for it.

```
Bad:   "a file reachable only by workflow_dispatch can sit dead"
Good:  "the rejection shows only when someone runs it"
```

The same goes for coined terms. A private word that stands for a concept, then recurs across the page, makes every later sentence depend on having read the one that coined it. Main concepts earn a term when it is defined once, near the top, where the reader will look for it ("launchers" in `docs/design/paper-ci.md`). Everything else is said in full each time.

### Do not imply a decision that has not been made

Where a choice is still open the text says so. A definite article is a claim.

## Design pages

`[R#]` and `design §N` are cited from source comments, and `npm run check:refs` reports each one that does not resolve to an `(r#)=` or `(design-N)=` anchor under `docs/design/`. An anchor moves between pages; while a citation to it survives it is never duplicated and never dropped. Deleting an entry means deleting its citations in the same commit.

An entry earns prose on a design page when it constrains behaviour now. A bug that was fixed, a run that passed, a sweep that finished: those are deleted.

The ref check is the only thing here a machine checks. The rest is convention that review applies.

## In code

### Module headers

Every module opens with a short block comment: what the module does, then optionally the constraint or decision that explains why it exists, citing `design §N` or `[R#]`. If there is lots to say, it gets a docs page.

```ts
/**
 * The only module that imports myst-cli, so the rest of oak is testable without it. oak calls
 * myst as a library, not a subprocess [design §7a].
 */
```

### Comments

Comments earn their place or go: state the constraint, not the story.

**Keep**, each in one line:

- A comment stating a **constraint, invariant, or ratified decision**, citing the reference the reader can open (below) rather than restating it.
- A comment saying **why this is not the obvious approach**: a dead end, named.
- A comment saying **why this looks wrong but is not**. It guards against a plausible wrong edit, so it reads as narration and is the one most likely to be deleted by mistake. Keep it.

**Go:**

- A comment **narrating the next line**.
- A comment describing **what the code used to do** (see *Describe the thing as it is*, above).
- A **long rationale**: it becomes a link or an `[R#]`, never a paragraph.

Name what a comment refers to: `{@link applyProvisioning}`, or a test by its name and file (`template disjointness invariant` in `test/template.test.ts`), not "the caller" or "the packaging test". A name can be searched and followed. "The caller" is fine only when there are many.

When in doubt, cut. A three-line justification is a one-line constraint plus its reference.

### Which reference to cite

Cite the one the reader *of this file* can open:

- `[R#]` for engine internals (see *Design pages*, above).
- a `DOCS.*` symbol for a verb's **observable behaviour**. If the sentence stays true reading only what the CLI does, it is user docs, not a source comment. Cite the symbol, never a raw `docs/` path or URL: symbols are tested to resolve, raw paths are not, and a page that does not exist yet is not a link to make.
- where neither resolves, the one line must be self-contained.

```ts
// BAD:  read from brand.yml directly, not the merged config, so that only
//       brand-declared assets are treated as brand-relative
// GOOD: read from brand.yml, not merged config [R42]
```

Files seeded into paper or journal repos carry **no** `[R#]`, since their readers cannot resolve one; they cite the docs URL instead.

### JSDoc

Every export gets one: contract first (what it returns, what it throws), in a line or two. A constraint riding along in a JSDoc is still one line plus its `[R#]`. Cross-reference other symbols with `{@link Name}`, not a bare mention.

## In oak's output

Every string `oak` prints, including from the workflows it seeds.

- Name the tools doing the work: mystmd, gh, git, Cloudflare, Zenodo. `oak` is the engine.
- Every default or auto-resolved value appears in the plan, on a row labelled by the flag that sets it, marked `(default)` when no flag did.
- An error names the file and the fix, starts with `oak <verb>:`, and never shows a stack.
- A refusal or an after-run note says what to do in one line. Anything more is a docs link.
- Short beats complete. If a clause survives deletion, delete it.
- No filler ("Oops", "Sorry", "Unfortunately"), no exclamation marks, no emoji outside PR comments.

## Candidates

Staging area. Nothing here is in force, and nothing here should be raised in review. A candidate is promoted when there are edits behind it, not when it sounds right.

- `[unverified]` **A heading states the subject, not a claim.** "There is no central website" became "Repository layout", and "The engine does not render anything" became "Processing MyST markdown". A heading that argues has to be re-read once the section has made the argument properly.
- **Name what a reference points to.** "Two values a fork controls go through it" drew "which values?", and "these two things" drew "unclear why you're saying these". Name the values, not their count.
- **State a rule as a rule.** "A guard is only known to close a finding once its input has been run through it" is neither an instruction nor a fact. Write the rule: "A guard that answers a finding is tested with that finding's own input."
- `[unverified]` **Do not signpost what the page is about to do.** "It covers the three things the rest of the section assumes you already know" was cut whole, and the sections covered them anyway.
