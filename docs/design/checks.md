(design-checks)=

# The editorial checks

(r208)=
## The journal's custom checks

A journal can write custom checks of its own, in JavaScript, and keep them in the journal repository. They are listed under `checks` in `journal.yml` because authors cannot change that file. A paper's MyST `error_rules` and plugins cannot be the gate, because the author controls them.

[Custom checks](../guide/checks.md#journal-checks) in the guide is the reference: how to write one, and what a check gets and returns. A custom check is named by its relative path, which is also its id. The path has to stay inside the journal repository: in CI the journal is cloned into the paper's checkout, at `_build/journal/<owner>/<name>`, so a path leaving it would reach files the author controls. Only `.mjs` files load, because Node reads a `.js` file as CommonJS or as an ES module depending on a `package.json` the journal repository may not have.

A custom check is shaped like a Curvenote one, so a check moves between the two with only its reads of the paper rewritten. Where a Curvenote check gets a MyST session, a custom check gets plain data: it loads from the journal clone, where nothing is installed, so it cannot import myst-cli. oak builds that data once per run and gives each check its own copy.

The journal repository is not pinned ([why](#processing-myst)), so one custom check runs under every oak version the journal's papers pin. That is why oak only adds fields to the data a check gets, as it does to `journal.yml`.

Every check runs inside a `try`, Curvenote's included, so a check that throws becomes one error row and the others still run.
