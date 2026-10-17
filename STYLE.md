# Style

Conventions for the engine's code. For comments, messages and other prose, see `WRITING.md`.

## Naming

- `SCREAMING_SNAKE` for module constants, `camelCase` for everything else.
- `read*` for a raw lift out of a file, `render*` for template-to-string, `run*` / `cmd*` for verb entry points.
- Spell the tool out: `engineRepo`, not `repo`. A value that appears in YAML keeps the YAML spelling there (`engine_repo`) and is camelCased in TS.

## Errors

- A fault the user caused is a `UserError` carrying a `msg.*` string. It names the file and the fix, and never reaches them as a stack.
- A fault the engine caused is an ordinary `Error` and may be ugly.
- Never throw a string literal, and never build a user-facing sentence at the throw site: the words live in `messages.ts`.

## Messages

- Links are `docsUrl(DOCS.<topic>)`, never a raw URL.
- Keep `${…}` holes and `oak <verb>:` prefixes; tests assert on fragments.

## Reading files

A `read*` function returns undefined/empty when absence is a meaningful value, such as an option left unset. It throws when absence means the operation cannot proceed at all. Validation belongs to `oak validate`, in one place, where it can be reported coherently.

Narrow YAML reads with a guard (`typeof v === 'string' && v`), never a cast.

## Side effects

Inject network, `git`, `gh` and mystmd calls, so the logic under them stays testable offline. Keep `compose()` pure.

A single injectable is a parameter with a default (`base: string = DOCS_BASE`); several go in an options object.

## Imports

The import graph is layered and acyclic. If a new import would close a loop, move the shared code to its own module. Type-only imports across layers are fine.

Verbs are loaded with `await import()`, so an invocation loads only the modules its verb uses.

## YAML

Round-trip through the `yaml` Document API, never a textual patch or `sed`. This preserves the author's key order and comments.

## Enforcement

CI checks formatting, types and tests. Everything else here is convention that review applies.
