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

To test a change on GitHub before merging, see `RELEASING.md`: a dev release covers paper CI, and the `staging` branch covers conformance itself.

## Conventions and processes

- `STYLE.md`: how the code is written.
- `WRITING.md`: how prose reads, in the docs, comments, PR descriptions and oak's messages. Optional; see the AI policy below.
- The header of `src/messages.ts`: what a message oak prints must contain, and which printed text lives outside that file. Read it before adding or changing a message.
- `RELEASING.md`: how engine releases are cut.

## Commits and pull requests

Commit messages are conventional commits: `type(scope): summary`, such as `fix(upgrade): ...` or `docs: ...`. A pull request is squash-merged, and its title becomes the commit on `main`, so the title follows the same form.

## AI policy

LLMs are fine here; I use them too. A person stands behind every contribution:

- Review and test LLM-generated code yourself. You should be able to explain any line of it.
- An LLM may draft the PR description if you read and edit it before posting. Read below for my opinion on LLM prose. Answer review questions yourself.
- Say in the PR which tool you used and for what, such as "Drafted with Claude Code; I reviewed and edited." It helps review and does not count against you.
- Reproduce a bug before reporting it.

The easier a PR is to read, the more likely I am to engage with it.

LLMs are not great (yet?) at prose. This is problematic, especially for a package aimed at not-exactly-technical-experts; their explanations are hard to read, they rely on assumptions (which are not the same I and you would make), often present weird quirks (LLM-isms), and sometimes miss the point entirely. `WRITING.md` lists the patterns I keep editing out of LLM drafts. In my experience, it works best as instructions you give an LLM before it drafts. Use it if it helps; I point agents at it to get better baselines and reviews.

I know of [Vale](https://vale.sh) with [vale-ai-tells](https://github.com/tbhb/vale-ai-tells), which flags some of these patterns mechanically. If it's useful to you, consider running it once for a mechanical pass.

Please review your contributions!

Partly inspired from [mystmd's](https://github.com/jupyter-book/mystmd/blob/main/docs/contributing.md#ai-policy) and a few other policies. We're working on it!