# Contributing

This covers the engine. Papers follow their journal's rules.

## Development

Node 22 or later.

```
npm install
npm test
npm run typecheck
npm run format
```

Code follows `STYLE.md`. `RELEASING.md` explains how releases are cut.

## AI policy

LLMs are fine here; I use them too. A person stands behind every contribution:

- Review and test LLM-generated code yourself. You should be able to explain any line of it.
- Write the PR description and review replies yourself. A grammar check is fine.
- Say in the PR which tool you used and for what. It helps review and does not count against you.
- Open PRs and issues yourself, not through an agent.
- Reproduce a bug before reporting it.

In my experience, LLM prose lacks clarity and brevity. `WRITING.md` has the rules I give an LLM to get a baseline draft, which I then review and edit. Use them if they help.

Adapted from [mystmd's](https://github.com/jupyter-book/mystmd/blob/main/docs/contributing.md#ai-policy).
