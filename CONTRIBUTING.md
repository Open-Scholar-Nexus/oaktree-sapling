# Contributing

This covers the engine. Papers follow their journal's rules.

## Development

Node 22 or later.

```
npm install
npm test
npm run typecheck
npm run format         # CI runs npm run format:check
npm run docs           # preview the docs site locally
```

Code follows `STYLE.md`. `RELEASING.md` explains how engine releases are cut. To test a change on GitHub before merging, see `RELEASING.md`: a dev release covers paper CI, and the `staging` branch covers conformance itself.

## Commits and pull requests

Commit messages are conventional commits: `type(scope): summary`, such as `fix(upgrade): ...` or `docs: ...`. A pull request is squash-merged, and its title becomes the commit on `main`, so the title follows the same form.

## AI policy

LLMs are fine here; I use them too. A person stands behind every contribution:

- Review and test LLM-generated code yourself. You should be able to explain any line of it.
- An LLM may draft the PR description if you read and edit it before posting. Answer review questions yourself.
- Say in the PR which tool you used and for what, such as "Drafted with Claude Code; I reviewed and edited." It helps review and does not count against you.
- Reproduce a bug before reporting it.

The easier a PR is to read, the more likely I am to engage with it.

In my experience, LLM prose lacks clarity and brevity. `WRITING.md` has the rules I give an LLM to get a baseline draft, which I then review and edit. Use them if they help.

Adapted from [mystmd's](https://github.com/jupyter-book/mystmd/blob/main/docs/contributing.md#ai-policy).
