/**
 * The strings oak prints for people, grouped by where they appear: the output helpers, then
 * usage, the confirm prompt, bootstrap, upgrade, build and start, the pinned oak version,
 * validate, what lands on a pull request, and the verbs the workflows run.
 *
 * Fixed strings are consts, parameterised ones functions. Keep the `${…}` holes and the
 * `oak <verb>:` prefixes, which say which command spoke; some tests assert on fragments. Nothing
 * here does work beyond choosing a phrasing, and the one import is the docs link table. A link
 * is `docsUrl(DOCS.<topic>)`, never a URL, and only where the page says more than a sentence can.
 *
 * The rules:
 *   1. Every default or resolved value is declared in the plan before the confirm prompt.
 *   2. No design-doc jargon ([S#]/[R#], "frozen shim", "build_type=workflow",
 *      "instance-config"). Enforced by a lint in messages.test.ts.
 *   3. Prose goes to stderr; the JSON only with `--json`, on stdout.
 *   4. An error names the file and the fix, and shows no stack trace.
 *
 * ── Printed text that is NOT in this file ───────────────────────────────────────────────────
 * These ship as files or run inside GitHub Actions, so they cannot import this module:
 *
 *   templates/paper/README.md ............... what an author reads first in their repo
 *   templates/paper/myst.yml ................ the commented starter config (CHANGE-ME lines)
 *   templates/paper/index.md ................ the starter manuscript
 *   templates/paper/CODEOWNERS .............. its header comment
 *   templates/paper/.github/workflows/*.yml . job names and `::error::` annotations (build-paper,
 *                                             deploy-preview, check-paper, post-checks, reserve-doi,
 *                                             deposit-version: the names show in the Actions tab)
 *   templates/instance/README.md ............ what a journal editor reads first
 *   templates/instance/journal.yml .......... the journal's settings and their comments
 *   templates/instance/brand/brand.yml ...... the branding settings and their comments
 *   templates/instance/editions/edition.yml . the edition template
 *   templates/instance/registry/papers.yml .. the paper list's header comment
 *   templates/site/myst.yml ................. the journal website's config comments
 *   templates/site/pages/index.md ........... the journal website's landing page
 *   templates/site/.github/workflows/site.yml the website job and its failure annotation
 *   plugins/gallery.mjs ..................... the paper-cards directive's messages
 *   templates/typst/*.typ ................... the PDF's fixed wording (headers, footers)
 *   ci/run.sh ............................... the launchers' own echoes
 *
 * Two TS files keep their own strings, both read only in a CI log:
 *   src/conformance.ts . `oak conformance` is the maintainers' release test; its lines are
 *                        progress markers.
 *   src/zenodo.ts ...... the `[prepare]`/`[publish]` progress markers and the Zenodo API's own
 *                        error bodies, echoed as they are. The one line for authors there is the
 *                        skipped-ORCID warning.
 *
 * The editorial checks' own messages come from `@curvenote/check-implementations`.
 */

import { DOCS, docsUrl } from './docs-links.js';
import type { JournalCache } from './gh.js';
import type { HandoffVerb, PinnedEngine, PinSource } from './pinned.js';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Output plumbing: not prose, but it decides HOW the prose is printed.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** An age for a person: minutes under an hour, hours under two days, then days. */
export function age(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** Are we inside a GitHub Actions run? Annotations mean something only there. */
export function inCI(): boolean {
  return Boolean(process.env.GITHUB_ACTIONS ?? process.env.CI);
}

/**
 * A warning or error line. `::warning::…` becomes an annotation in a workflow log and is noise in
 * a terminal, so it is added only in CI. There a message is escaped as GitHub specifies, since the
 * runner reads a line after a raw CR or LF as a new workflow command.
 */
export function annotate(kind: 'notice' | 'warning' | 'error', message: string): string {
  if (!inCI()) return kind === 'warning' ? `warning: ${message}` : message;
  const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::${kind}::${escaped}`;
}

/**
 * An error written for whoever ran the command. `main()` prints it as a sentence, with no stack
 * trace, and exits 2. Anything else reaching the top level is a bug in oak and gets its stack.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * A one-line summary of a thrown error, to put in a message. A zod error's `message` is JSON
 * starting with `[`, so its first issue is named instead; any other error gives its first
 * non-empty line.
 */
export function firstLine(e: unknown): string {
  const issues = (e as { issues?: Array<{ path?: unknown[]; message?: string }> })?.issues;
  const first = Array.isArray(issues) ? issues[0] : undefined;
  if (first) {
    const where = (first.path ?? []).join('.');
    return where ? `${where}: ${first.message}` : (first.message ?? 'invalid');
  }
  const line = String((e as Error)?.message ?? e)
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  return line ?? 'unreadable';
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Usage: the first screen a new user sees.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * It opens with what oak is and where to start.
 */
export const usage = (): string =>
  `oak: a mystmd-based engine for running a small journal. It sets up the journal\n` +
  `(its branding, editions and list of papers) and the repos its papers live in, then\n` +
  `builds, checks, previews and publishes each paper with the journal's settings. It\n` +
  `drives git and gh (the GitHub CLI) under the hood; anything that changes a repo\n` +
  `prints a plan and asks before it does it.\n` +
  `\n` +
  `Starting from nothing? Create the journal, then a repo per paper:\n` +
  `  oak bootstrap journal --repo <owner/name> --name "My Journal" --edition 2026\n` +
  `  oak bootstrap paper   --repo <owner/name> --instance <owner/journal-repo> --edition 2026\n` +
  `\n` +
  `Setting up repos\n` +
  `  oak bootstrap journal --repo <owner/name> [--name <name>] [--edition <id>]\n` +
  `                        [--engine-repo <owner/name>] [--engine-version <tag>] [--owner <@user|@org/team>]\n` +
  `                        [--no-require-checks] [--no-site] [--co-located] [--yes]\n` +
  `                    a public repo holding the journal's settings, branding, website and\n` +
  `                    list of published papers; each paper lives in a repo of its own that\n` +
  `                    points back at it\n` +
  `      --co-located  one repo for the journal, its website and its papers, each paper in\n` +
  `                    papers/<paper id>/\n` +
  `  oak bootstrap paper   --repo <owner/name> --instance <owner/journal-repo> --edition <id>\n` +
  `                        [--from <author-url> [--source-ref <ref>]]\n` +
  `                        [--engine-repo <owner/name>] [--engine-version <tag>] [--owner <@user|@org/team>]\n` +
  `                        [--private] [--no-require-checks] [--yes]\n` +
  `      --instance    the journal repo this paper belongs to ('.' only if the journal\n` +
  `                    settings live in this same repo); --edition names one of its editions\n` +
  `  Both bootstrap verbs: --engine-version naming another oak version runs that version's\n` +
  `  bootstrap, fetched once into ~/.cache/oak.\n` +
  `  oak add-paper --repo <owner/journal> --id <paper id> [--edition <id>] [--yes]\n` +
  `                    in a co-located journal: fork it, add papers/<paper id>/ from the\n` +
  `                    starter manuscript, and open the pull request an editor merges\n` +
  `  oak upgrade (--repo <owner/name> | --paper <dir>) [--to <tag>] [--files-only] [--yes]\n` +
  `                    move a paper repo to a newer engine version, as a pull request\n` +
  `\n` +
  `Working on a paper\n` +
  `  oak validate [--paper <dir>] [--instance <dir> | --no-instance] [--typst-template <dir>] [--strict] [--report <path>]\n` +
  `                    run the journal's checks over a manuscript and report what fails\n` +
  `  oak build   [--paper <dir>] [--instance <dir> | --no-instance] [--base-url <url>] [--no-site-template]\n` +
  `              [--exports-only | --no-exports] [--typst-template <dir>]\n` +
  `                    build the paper's website + PDF into _build/\n` +
  `  oak start   [--paper <dir>] [--instance <dir> | --no-instance] [--typst-template <dir>] [--port <n>] [--server-port <n>]\n` +
  `                    run mystmd's live preview of the paper, with the journal's settings\n` +
  `                    and branding applied (the same config its CI builds). Reloads as you\n` +
  `                    edit; Ctrl-C stops it. Run in the journal repo, it previews the\n` +
  `                    journal website instead.\n` +
  `  validate, build and start run the oak version the paper's myst.yml pins, fetched once\n` +
  `  into ~/.cache/oak.\n` +
  `  OAK_USE_RUNNING=1 runs this oak instead of fetching, for developing oak itself.\n` +
  `\n` +
  `Run by the workflows (rarely typed by hand)\n` +
  `  oak post-checks --report <path> --repo <owner/repo> --sha <headsha> --base <branch>\n` +
  `                  --verified-head <headsha>\n` +
  `  oak deploy-preview <site> [--verified-head <headsha>] [--instance <dir> | --no-instance] [--repo <owner/repo>]\n` +
  `  oak notify new-version [--pr <n> | --site <dir>] [--repo <owner/repo>]\n` +
  `  oak deposit prepare --repo <owner/repo> [--site-url <url>] [--sandbox] [--instance <dir> | --no-instance]\n` +
  `  oak deposit publish --pdf <path> --tag <vX.Y.Z> [--site-url <url>] [--sandbox] [--instance <dir> | --no-instance]\n` +
  `  oak deposit status  [--sandbox] [--instance <dir> | --no-instance]\n` +
  `  oak release --tag <vX.Y.Z | <paper id>/vX.Y.Z> [--no-build] [--paper <dir>] [--instance <dir> | --no-instance]\n` +
  `              [--site-url <url>]\n` +
  `  oak papers (--for build|check | --tag <tag> | --id <paper id> | --id-env)\n` +
  `                    the papers a workflow run works on, as JSON\n` +
  `  oak assemble --builds <dir> [--base-url <path>]\n` +
  `                    in a co-located repo: build the journal website and mount each listed\n` +
  `                    paper's build at /<paper id>/\n` +
  `  oak conformance reset   --repo <owner/name>\n` +
  `  oak conformance run   --repo <owner/name> --tag <vX.Y.Z> [--fork-repo <owner/name>]\n` +
  `\n` +
  `Any command\n` +
  `  --help      print this text; --version prints oak's version\n` +
  `  --json      print the full machine-readable result on stdout instead of a summary\n` +
  `  --verbose   show the raw git/gh commands' output (shown on failure either way)\n`;

/** `near` is the closest command, when one is close enough to suggest. */
export const unknownCommand = (verb: string, near: string | null): string =>
  `oak: unknown command '${verb}'${near ? `; did you mean '${near}'?` : ''}\n`;

export const flagNeedsValue = (name: string): string =>
  `--${name} needs a value. It was passed with none, which usually means an empty shell ` +
  `variable: quote it, or drop the flag to use the default.`;

export const version = (v: string): string => `oak ${v}`;

export const flagNeedsPort = (name: string, got: string): string =>
  `--${name} needs a port number, not '${got}'.`;

/** A YAML file the parser reports an error in (yaml-io.ts `parseYaml`). `why` is the parser's
 *  first line, which gives the line and column. */
export const yamlInvalid = (file: string, why: string, duplicateKey: boolean): string =>
  `${file} is not valid YAML: ${why}. ` +
  (duplicateKey
    ? 'A key can appear only once in the same block; keep one of them.'
    : 'Fix that line and run again.');

/** A YAML file with a `---` (or `...`) line that starts a second document (yaml-io.ts
 *  `parseYaml`). */
export const yamlMultipleDocs = (file: string, line: number, marker: string): string =>
  `${file} holds more than one YAML document: the ${marker} at line ${line} splits it. Keep ` +
  `one document: delete that line, and merge what follows into the rest.`;

/** A YAML value with `: ` in it, read as a second key (yaml-io.ts `parseYaml`). */
export const yamlColonInValue = (file: string, line: number): string =>
  `${file} is not valid YAML: the value at line ${line} holds a colon and a space, which YAML ` +
  `reads as a new key. Put the whole value in quotes, like title: "Tides: a study".`;

/** A YAML line where a key is expected but none is written (yaml-io.ts `parseYaml`). */
export const yamlNotKeyValue = (file: string, line: number): string =>
  `${file} is not valid YAML: line ${line} should be a key, a colon and a space, then the ` +
  `value (id: my-paper). Fix that line and run again.`;

/** journal.yml parses but a setting has the wrong shape (yaml-io.ts `readJournalConfig`). */
export const journalInvalid = (file: string, why: string): string =>
  `${file} has a setting oak cannot read (${why}). Fix it in the journal repo and run again.`;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The confirm prompt: every plan ends here.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const prompt = {
  proceed: 'Proceed? [y/N] ',

  nonTty:
    'aborted: stdin is not a TTY, so the plan above could not be confirmed interactively. ' +
    'Nothing was created or changed. Re-run with --yes to accept the plan unattended.',

  declined: (answer: string): string =>
    `aborted: the plan above was not confirmed (` +
    `${answer ? `answered "${answer}"` : 'no answer; the default is No'}). ` +
    'Nothing was created or changed. Re-run and answer "y", or pass --yes.',

  /** The `reason` field of an aborted result, for `--json`. */
  abortedNothingCreated: 'the plan above was not confirmed; nothing was created or changed',
  abortedNoPr:
    'the plan above was not confirmed; nothing was changed and no pull request was opened',
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * oak bootstrap
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The plan's opening block: every value the run will use, one row per flag, with `(default)`
 * on the ones no flag set. Most end up in files that are awkward to change later, so
 * `Proceed? [y/N]` covers them all.
 */
export const declared = {
  journalRepoCoLocated: '. (this repo itself)',
  journalRepo: (repo: string): string => `${repo}: the journal this paper belongs to`,

  journalNameGiven: (name: string): string => name,
  journalNameDefault: (name: string): string =>
    `${name} (default): a placeholder in journal.yml, brand/brand.yml and the edition file`,

  editionGiven: (edition: string): string => edition,
  editionDefault: (edition: string): string =>
    `${edition} (default): written as editions/${edition}.yml; papers name this id`,

  engineVersionGiven: (tag: string): string => tag,
  engineVersionGivenOther: (tag: string, running: string): string =>
    `${tag}: the files come from the running oak (${running})`,
  engineVersionDefault: (tag: string): string => `${tag} (default): the version of the running oak`,
  newerRelease: (running: string, newer: string): string =>
    `  ! ${newer} is newer than this oak (${running}), so this repo is pinned to v${running}. ` +
    `To pin ${newer}, run this again with \`npx oaktree-sapling@latest\` or after ` +
    `\`npm install -g oaktree-sapling\`.`,

  engineRepoGiven: (repo: string): string => repo,
  engineRepoDefault: (repo: string): string =>
    `${repo} (default): where the workflows fetch the engine from`,

  ownerGiven: (owner: string): string =>
    `${owner}: written into CODEOWNERS, so this is who must approve changes`,
  ownerDefault: (owner: string): string =>
    `${owner} (default): your own GitHub login; written into CODEOWNERS, so this ` +
    `is who must approve changes`,

  /** Row labels, in the order they print: the flag that sets each value. */
  labels: {
    journalRepo: '--instance',
    journalName: '--name',
    edition: '--edition',
    engineVersion: '--engine-version',
    engineRepo: '--engine-repo',
    owner: '--owner',
  },
};

export const bootstrap = {
  // ── refusals, before anything is created ───────────────────────────────────────────────
  instanceRequired:
    'oak bootstrap paper: --instance <owner/journal-repo> is required. It names the ' +
    'journal this paper belongs to and is written into .github/actions/engine/pins.yml, ' +
    "where the paper's workflows read it to fetch the journal's branding, its edition " +
    'and the checks it wants run. Without it the repo bootstraps fine and then every CI ' +
    'run fails with "no journal repo found". Pass `--instance .` only for a repo ' +
    'that carries its own journal.yml (use `oak bootstrap journal --co-located` to stand ' +
    'one up). What the paper gets out of that connection: ' +
    docsUrl(DOCS.paperJournalLink),

  editionRequired: (instance: string): string =>
    "oak bootstrap paper: --edition <id> is required. It says which of the journal's " +
    "editions this paper appears in, and is written into the paper's myst.yml; the " +
    'journal repo must already have an editions/<id>.yml with that exact name. The ids ' +
    'are the filenames under editions/ in ' +
    (instance === '.' ? 'this repo' : `https://github.com/${instance}`) +
    ' (`oak bootstrap journal` creates the first one). Defaulting it would only move the ' +
    'failure into the first CI run. What an edition file holds: ' +
    docsUrl(DOCS.fileEditions),

  noSiteNeedsExternal:
    '--no-site does not apply with --co-located: the website is where a co-located journal ' +
    'publishes its papers, each at /<paper id>/.',

  ghMissing:
    'oak bootstrap: the GitHub CLI (gh) is not on PATH. Install it, run `gh auth login`, ' +
    'then re-run this command; everything it does on GitHub goes through gh.',
  ghNotAuthed:
    'oak bootstrap: gh is installed but no account is logged in. Run `gh auth login` and ' +
    're-run this command; it creates and configures GitHub repos through that login.',

  // ── the plan ───────────────────────────────────────────────────────────────────────────
  paperPlanHeader: (mode: 'ingest' | 'bare', repo: string): string =>
    `bootstrap paper (${mode === 'ingest' ? "importing an author's repo" : 'new, empty paper'}): ${repo}`,
  journalPlanHeader: (external: boolean, repo: string): string =>
    `bootstrap journal (${external ? 'its own repo; papers live elsewhere' : 'journal, website and papers in one repo'}): ${repo}`,

  planRepoExists: '  ✓ repo exists',
  planCreateRepo: (isPrivate: boolean): string =>
    `  ○ create repo (${isPrivate ? 'private' : 'public'})`,
  planCreateJournalRepo: (external: boolean): string =>
    `  ○ create repo (public${external ? ', and it must stay so: paper builds read it without a token' : ''})`,
  planPrivate:
    "  ! on GitHub's free plan a private repo cannot have repo rulesets or Pages, so those " +
    'steps will fail late in this run (403), after the repo and its content are already in ' +
    'place. Create the repo public, or confirm your GitHub plan covers private repos, before ' +
    'proceeding.',

  planMainSeeded: '  ✓ main exists',
  planSeedPaper:
    '  ○ commit to main: the starter manuscript and the GitHub Actions workflows that build and check it',
  planSeedJournal: (withSite: boolean): string =>
    `  ○ commit to main: the journal's settings, branding and paper list${withSite ? ', plus the journal website' : ''} (${docsUrl(DOCS.files)})`,
  planSeedCoLocated:
    "  ○ commit to main: the journal's settings, branding and paper list, the journal website, " +
    'an empty papers/ folder, and the workflows that build, check and publish each paper',

  /** A rerun that changes an answer does not commit to main again, so it would succeed
   *  while changing nothing. */
  planAlreadySeededPaper: (instanceRepo: string): string =>
    `  ! main already exists; this run will NOT rewrite the workflows or` +
    ` .github/actions/engine/pins.yml, so the journal repo and engine version an earlier` +
    ` bootstrap wrote stay as they are (this run would have set instance_repo:` +
    ` ${instanceRepo}). To change them, run \`oak upgrade\` or edit` +
    ` .github/actions/engine/pins.yml in a pull request.`,
  planAlreadySeededJournal:
    '  ! main already exists; this run will NOT rewrite the files there, so a changed' +
    ' --name/--edition/--engine-version will not reach them. Edit the repo directly.',

  planReviewBranchExists: '  ✓ review branch exists',
  planReviewBranch: (from: string, ref: string): string =>
    `  ○ copy the author's files from ${from}@${ref} onto a "review" branch`,
  ingestBadUrl: (url: string): string =>
    `oak bootstrap: --from must be a GitHub repo URL (https://github.com/owner/repo or ` +
    `git@github.com:owner/repo), got: ${url}. A URL carrying a username or password is refused ` +
    `too, because --from is copied into a public commit message and pull request.`,
  ingestBadRef: (ref: string): string =>
    `oak bootstrap: --source-ref must be a branch, tag or commit name, got: ${ref}. git reads a ` +
    `leading dash as an option, so a ref like --upload-pack=... would run a command here.`,
  planReviewPrExists: '  ✓ review → main PR open',
  planReviewPr: '  ○ open the review → main pull request',

  planProvisioning:
    '  ○ repo settings: branch and tag rules, GitHub Pages, Zenodo environments, Actions ' +
    'permissions, issue labels',
  planSecrets: (names: string): string =>
    `  ○ secrets: ${names || 'none given; you get a list of what to set by hand'}`,
  planPages: (siteUrl: string): string =>
    `  ○ turn on GitHub Pages for the journal website (${siteUrl}) and link it from the repo page`,
  planNoSite: '  ○ no journal website (--no-site)',

  // ── the issue labels oak creates, shown in the repo's labels list ──────────────────────
  labelEditorAction: 'An editor must take action before this can proceed',
  labelZenodoFailed: 'A Zenodo publish run failed and needs editor attention',

  // ── the repo descriptions, shown on GitHub ─────────────────────────────────────────────
  descriptionPaper: 'A paper, created by `oak bootstrap paper`',
  descriptionJournal:
    'Journal settings, branding and paper list, created by `oak bootstrap journal`',
  descriptionCoLocated:
    'Journal, website and papers in one repo, created by `oak bootstrap journal --co-located`',

  // ── the running log ────────────────────────────────────────────────────────────────────
  logCreated: (repo: string): string => `  ✓ created ${repo}`,
  logCreatedPublic: (repo: string): string => `  ✓ created ${repo} (public)`,
  logMadePublic:
    '  ✓ made the repo public (paper builds read these settings from here with no token)',
  logSeeded: '  ✓ committed to main',
  /** A repo that already existed may not default to `main` [R127]. */
  logDefaultBranch: (from: string): string => `  ✓ default branch switched from ${from} to main`,
  logReviewBranch:
    "  ✓ built the review branch: the author's files, with this repo's own workflows and settings restored over them",
  logPrOpened: (url: string): string => `  ✓ opened PR ${url}`,
  logTeamGranted: (team: string): string => `  ✓ ${team} team granted write`,
  logRulesetExists: (name: string): string => `  ✓ branch rule '${name}' already exists`,
  logRulesetCreated: (name: string): string =>
    `  ✓ created branch rule '${name}': changes to main need a pull request approved by a code owner`,
  logTagRuleExists: (name: string): string => `  ✓ tag rule '${name}' already exists`,
  logTagRuleCreated: (name: string): string =>
    `  ✓ created tag rule '${name}': only editors can create tags, which publish a version`,
  logPagesExists: '  ✓ GitHub Pages already enabled',
  logPagesEnabled: '  ✓ GitHub Pages enabled (published by a workflow)',
  logHomepageExists: (url: string): string => `  ✓ repo website link already set (${url})`,
  logHomepageSet: (url: string): string =>
    `  ✓ repo website link set to ${url} (shown under About on the repo page)`,
  logActionsPrsExists: '  ✓ Actions may already open pull requests',
  logActionsPrsAllowed:
    '  ✓ Actions allowed to open pull requests (the DOI write-back is one of them)',
  logZenodoEnvExists:
    "  ✓ the 'zenodo-publish' environment already restricts its secrets to v* and */v* tags",
  logZenodoEnvCreated:
    "  ✓ created the 'zenodo-publish' environment: only v* and */v* tags may use its secrets",
  logMainEnvExists: (env: string): string =>
    `  ✓ the '${env}' environment already restricts its secrets to main`,
  logMainEnvCreated: (env: string): string =>
    `  ✓ created the '${env}' environment: only main may use its secrets`,
  logSecretSet: (name: string, env: string): string => `  ✓ secret ${name} set on '${env}'`,
  logRepoSecretDeleted: (name: string): string =>
    `  ✓ deleted the repository secret ${name}; its environments hold it now`,
  logSiteAdded: (siteUrl: string): string => `  ✓ journal website added: ${siteUrl}`,
  logStepFailed: (step: string, why: string): string => `  ✗ ${step} failed: ${why}`,
  logRunbookLine: (line: string): string => `  → ${line}`,
  logPartial: (steps: string): string =>
    `  ! this run is incomplete; failed steps: ${steps}. What to do about each is in the ` +
    'runbook above.',

  // ── the pull request that `--from` opens ───────────────────────────────────────────────
  ingestCommitMessage: (from: string): string =>
    `Submission from ${from}\n\nOriginal repo: ${from}`,
  ingestPrTitle: (owner: string): string => `Submission: ${owner}`,
  ingestPrBody: (from: string): string =>
    `Original repo: ${from}\n\n---\n\n*Opened by \`oak bootstrap paper --from\`.*`,

  // ── the runbook (what to do once the command has finished) ─────────────────────────────
  runbookSecrets: (repo: string, missing: string): string =>
    `Set the remaining secrets on their environments at https://github.com/${repo}/settings/environments : ` +
    missing +
    '. Until they are set, publishing to Zenodo (ZENODO_TOKEN*) and live pull-request ' +
    'previews (CLOUDFLARE_*) are skipped; everything else works, and a preview falls back ' +
    'to a downloadable copy of the built site.',

  runbookRepoSecrets: (repo: string, names: string): string =>
    `${names} is still a repository secret on ${repo}, which a workflow on any branch can read. ` +
    `Re-run with its value: it lands on its environments and the re-run deletes this copy.`,

  runbookStepFailed: (repo: string, step: string, why: string): string =>
    `The '${step}' step failed (${why}); ${repo} keeps everything else this run set. Fix the ` +
    `cause and re-run the same command: steps that already succeeded are skipped.`,

  runbookFillPaper: (repo: string): string =>
    `Next: in a pull request to https://github.com/${repo}, fill in myst.yml: project.id ` +
    `(unique in the journal, in the shape its id_pattern asks for), the title and the authors. ` +
    `Until the id is set the Journal checks fail and GitHub Pages is not deployed.`,

  runbookForkApproval:
    `The first time someone opens a pull request from their own fork, GitHub asks an editor to ` +
    `approve the workflow run before it starts: one click in the repo's Actions tab, per new ` +
    `contributor. There is no way to switch this off.`,

  // oak has no invite command: authors work from a fork by default [R124].
  runbookAuthorAccess: (repo: string): string =>
    `Authors work from a fork of ${repo}; there is nothing to set up. To give an author push ` +
    `access instead: gh api -X PUT repos/${repo}/collaborators/<github-user> -f permission=push ` +
    `(they can then push branches here; main still needs a pull request and only editors can ` +
    `create v* tags).`,

  runbookStartHere: `Next: clone the repo and edit journal.yml and brand/. See ${docsUrl(DOCS.journalStart)}`,

  runbookAddPaper: (repo: string): string =>
    `An author adds a paper with oak add-paper --repo ${repo} --id <paper id>, which opens a pull ` +
    `request from their fork; merging it adds the paper as a draft, and listing it in ` +
    `registry/papers.yml publishes it. See ${docsUrl(DOCS.colocated)}`,
  runbookColocatedSite: (siteUrl: string): string =>
    `The website goes live at ${siteUrl} a few minutes after the first "Build paper" run on main ` +
    'finishes (Actions tab).',
  runbookSite: (siteUrl: string): string =>
    `The website goes live at ${siteUrl} a few minutes after the first "Journal site" run ` +
    'finishes (Actions tab).',
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * oak upgrade
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const upgrade = {
  missingTarget: 'oak upgrade: pass --paper <dir> or --repo <owner/name>',

  notAPaperRepo: (pinsRel: string): string => `no engine_repo in ${pinsRel}. Is this a paper repo?`,

  upToDate: (target: string, engineRepo: string, targetGiven: boolean): string =>
    `up to date at ${target}${targetGiven ? '' : ` (the newest release of ${engineRepo}; no --to given)`}; no pull request.`,

  pinAhead: (pin: string, target: string, engineRepo: string): string =>
    `kept ${pin}: it is newer than ${target} (the newest release of ${engineRepo}); no pull ` +
    `request. Pass --to <tag> to move it.`,

  badTarget: (target: string, engineRepo: string, targetGiven: boolean): string =>
    `oak upgrade: ${targetGiven ? '--to' : `the newest release of ${engineRepo}`} is ` +
    `${JSON.stringify(target.slice(0, 60))}, not a release tag like v1.2.3 or v1.2.3-dev.4; ` +
    `nothing was changed.`,

  /** `--files-only` would leave a version the engine action refuses. */
  badPin: (pin: string, file = 'myst.yml'): string =>
    `oak upgrade: ${file} pins ${JSON.stringify(pin.slice(0, 60))}, not a release tag like ` +
    `v1.2.3 or v1.2.3-dev.4, and --files-only leaves it; nothing was changed. Run it without ` +
    `--files-only, which moves the version too.`,

  /** Releases v0.3.0-dev.7 to v0.3.0-dev.13 write their minimum as `v0.3.0-0`. */
  badMinimum: (min: string, target: string): string =>
    `oak upgrade: pins.yml at ${target} names min_engine_version ${JSON.stringify(min.slice(0, 60))}, ` +
    `which this oak cannot compare with a version; nothing was changed. Pass --to <tag> naming ` +
    `a newer release.`,

  /** The pin this run leaves is older than the workflows it leaves need. */
  belowMinimum: (pin: string, min: string, filesOnly: boolean, file = 'myst.yml'): string =>
    `oak upgrade: the workflows need engine ${min} or newer, and this run would leave ` +
    `${file} at ${pin}; nothing was changed. ` +
    (filesOnly
      ? `Run it without --files-only, which moves the version too.`
      : `Pass --to <tag> naming ${min} or newer.`),

  planHeader: (repoRoot: string, target: string): string => `upgrade ${repoRoot} → ${target}`,
  planTarget: (target: string, engineRepo: string, targetGiven: boolean): string =>
    `  engine version : ${target}${
      targetGiven
        ? ' (--to)'
        : `: the newest release of ${engineRepo} right now, no --to given (pass --to <tag> to pick one)`
    }`,
  planBumpVersion: (from: string, target: string, file = 'myst.yml'): string =>
    `  ○ set the engine version in ${file}: ${from || '(unset)'} → ${target}`,
  planResync: (count: number, target: string, files: string): string =>
    `  ○ restore ${count} engine-managed file(s) that no longer match the ${target} template: ${files}`,
  planFilesMatch: (target: string): string =>
    `  ✓ the engine-managed files already match ${target}`,
  planAsPr:
    '  ○ all of the above goes up as a pull request for you to review; nothing is pushed to main',

  logPrOpened: (url: string): string => `opened upgrade PR ${url}`,
  logPrUpdated: (url: string): string => `updated upgrade PR ${url}`,
  logPrCurrent: (url: string): string => `upgrade PR ${url} already has these changes`,

  prTitle: (target: string): string => `Upgrade engine to ${target}`,
  prBodyHeader: (target: string): string => `Moves this repo to engine \`${target}\`.`,
  prBodyVersion: (target: string, files: string[] = ['myst.yml']): string =>
    `- sets the engine version → \`${target}\` in ${files.map((f) => `\`${f}\``).join(', ')}`,
  prBodyFiles: (target: string): string =>
    `- restores these engine-managed files to their ${target} version (a code owner must approve changes under \`.github/\`):`,
  planExtraFiles: (extra: string[]): string =>
    `  ! ${extra.length} file(s) under .github/ that this engine version does not ship: ` +
    `${extra.join(', ')}. Left alone. If one is a workflow a past engine shipped and has ` +
    `since retired, it is still running: delete it by hand.`,

  prBodyExtra: (target: string): string =>
    `Not touched, but worth a look: these live under \`.github/\` and are not part of ${target}. ` +
    `A retired engine workflow left here keeps running.`,

  prBodyFooter: '_Opened by `oak upgrade`. Review the preview build before merging._',
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * oak build / oak start
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** The verbs that find a journal repo the way `oak build` does. */
export type JournalVerb = 'build' | 'start' | 'validate' | 'release' | 'deposit' | 'deploy-preview';

/** What `--no-instance` gives each verb, for {@link build.noInstance}. */
const WITHOUT_JOURNAL: Record<JournalVerb, string> = {
  build: 'an unbranded build',
  start: 'an unbranded preview',
  validate: 'a bare, engine-only check',
  release: 'an unbranded build',
  deposit: "a deposit without the journal's Zenodo settings",
  'deploy-preview': "a preview without the journal's settings",
};

export const build = {
  done: (id: string): string => `oak build: done (id=${id})`,
  placeholder:
    'oak build: project.id in myst.yml is still the template placeholder; GitHub Pages is not ' +
    'deployed until it is set',
  finishFailed: (why: string): string =>
    `oak build: the site was built, but preparing it for upload failed (${why})`,
  /** oak's install lacks `templates/typst`, which every release and npm package ships. */
  noEngineTypstTemplate: (dir: string): string =>
    `oak build: oak's typst template is missing (${dir}). Reinstall oak, or run it from a full ` +
    `checkout.`,

  /** `oak build` in the journal repo, whose myst.yml is the website (cli.ts `isJournalRepo`). */
  inJournalRepo: (root: string): string =>
    `oak build: ${root} is the journal repo, not a paper. Its journal.yml holds the journal's ` +
    `settings and its myst.yml is the journal website; there is no manuscript here to build.\n` +
    `The website builds itself: every push to main runs the "Journal site" workflow, which ` +
    `publishes it to GitHub Pages. To look at it before you push, run \`npm install\` once in ` +
    `this repo and then \`oak start\`.\n` +
    `To build a paper, run oak build inside that paper's checkout, or pass ` +
    `--paper <path to the paper>.\n` +
    `What this repo is for: ${docsUrl(DOCS.journalStart)}`,

  /** The paper's `project.options.oaktree-sapling` version or edition is missing. It names the
   *  file and the fix, since the reader is looking at a paper that used to work. */
  missingEngineCoordinate: (field: 'version' | 'edition', mystPath: string): string =>
    `oak: ${mystPath} has no engine ${field}. Add the \`${field}:\` line back under ` +
    `\`project.options.oaktree-sapling\` (\`oak bootstrap paper\` writes ` +
    `${field === 'version' ? 'it and the edition' : 'it and the version'} when it creates a ` +
    `paper, and \`oak upgrade\` is what changes the version afterwards).\n` +
    (field === 'version'
      ? `It names the engine release that builds this paper, e.g. \`version: v0.1.0\`.`
      : `It names which of the journal's editions this paper appears in; the ids are the ` +
        `filenames under editions/ in the journal repo.`),

  badEngineVersion: (got: string, mystPath: string): string =>
    `project.options.oaktree-sapling.version is ${JSON.stringify(got.slice(0, 60))} in ${mystPath}. ` +
    `Pin a release tag like v1.2.3 or v1.2.3-dev.4, as the paper's CI does; \`oak upgrade\` ` +
    `sets one.`,

  badEdition: (got: string, mystPath: string): string =>
    `project.options.oaktree-sapling.edition is ${JSON.stringify(got.slice(0, 40))} in ${mystPath}. ` +
    `It names a file (editions/<edition>.yml), so it must be a plain name: letters, digits, . _ -`,
  /** No journal repo found: pins.yml names none (`instance_repo: .` or absent, which means the
   *  same) and no journal.yml sits beside the paper. */
  noInstance: (verb: JournalVerb, paperRoot: string): string =>
    `oak ${verb}: no journal repo found. .github/actions/engine/pins.yml names none ` +
    `(\`instance_repo: "."\` means the journal.yml sits in this repo), and there is no ` +
    `journal.yml at ${paperRoot}.\n` +
    `Set instance_repo in pins.yml to the journal's owner/repo (\`oak bootstrap paper ` +
    `--instance\` writes it), or pass --instance <path to a clone of the journal> or ` +
    `--no-instance for ` +
    `${WITHOUT_JOURNAL[verb]}. ` +
    `See ${docsUrl(DOCS.paperJournalLink)}`,

  /** Where a local run without `--instance` got the journal settings ({@link JournalCache}). */
  journalCache: (verb: JournalVerb, journalRepo: string, cache: JournalCache): string => {
    const head = `oak ${verb}: `;
    switch (cache.state) {
      case 'cloned':
        return (
          `${head}using the journal settings from ${journalRepo} (instance_repo in pins.yml), cloned ` +
          `to ${cache.root}. Pass --instance <path> to use a local clone.`
        );
      case 'updated':
        return `${head}using the journal settings from ${journalRepo}, updated just now in ${cache.root}.`;
      case 'reused':
        return (
          `${head}reusing the journal settings from ${journalRepo} fetched ${age(cache.ageMs)} ago ` +
          `(${cache.root}); delete that folder to fetch them now.`
        );
      case 'stale':
        return (
          `${head}could not update the journal settings from ${journalRepo} (${cache.why}); using ` +
          `the copy fetched ${age(cache.ageMs)} ago in ${cache.root}.`
        );
    }
  },

  instanceCloneFailed: (verb: JournalVerb, journalRepo: string, why: string): string =>
    `oak ${verb}: could not clone the journal ${journalRepo} named in .github/actions/engine/pins.yml ` +
    `(${why}). Pass --instance <path to a clone of the journal>, or --no-instance to go ` +
    `without its settings. See ${docsUrl(DOCS.paperPreviewLocally)}`,

  preflightFailed: (findings: string): string =>
    `oak build: pre-flight validation failed:\n${findings}`,

  /** The version and edition the paper declares differ from the merged config's: an extended
   *  layer overrides `project.options`. */
  coordinateMismatch: (
    version: string,
    edition: string,
    resolvedVersion: string,
    resolvedEdition: string,
  ): string =>
    `options.oaktree-sapling mismatch: the CI workflow read {version:${version}, edition:${edition}} ` +
    `but the merged config has {version:${resolvedVersion}, edition:${resolvedEdition}}. ` +
    `An extended config is likely overriding project.options.`,

  coordinateMissingFromResolved:
    'project.options["oaktree-sapling"] missing from the resolved myst config',
};

export const start = {
  composed: (root: string, instanceRoot: string | null, hasPdf: boolean): string =>
    `oak start: previewing ${root} with ${instanceRoot ? `the journal settings in ${instanceRoot}` : 'no journal settings (--no-instance): unbranded, engine defaults only'}.\n` +
    `This is the same config the paper's CI builds; myst reads myst.oak.yml, composed just now ` +
    `from your myst.yml. Edit myst.yml as usual; oak rewrites myst.oak.yml when you save it.\n` +
    (hasPdf
      ? `The PDF download serves the PDF from the last \`oak build\`; run it again to update it.\n`
      : `The preview has no PDF download until \`oak build\` makes the PDF.\n`) +
    `Press Ctrl-C to stop.`,

  journalSite: (root: string): string =>
    `oak start: ${root} is the journal repo, so this is a plain myst preview of the journal ` +
    `website; nothing to compose, no engine settings involved.\n` +
    `If the paper gallery is missing, run \`npm install\` in this repo first: the gallery plugin ` +
    `needs it.\n` +
    `Press Ctrl-C to stop.`,

  /** A journal website with a package.json and no node_modules: the gallery plugin's imports
   *  would fail to resolve. */
  siteNotInstalled: (root: string): string =>
    `oak start: ${root} has a package.json but no node_modules, so the paper gallery cannot ` +
    `load. Run \`npm install\` in this repo once, then \`oak start\` again.`,

  recomposed: 'oak start: myst.yml changed; recomposed, the preview will reload.',

  pdfAdded: 'oak start: the PDF is built; the preview now offers it for download.',

  pdfGone: 'oak start: the PDF was deleted; the preview offers no download until `oak build` runs.',

  recomposeFailed: (message: string): string =>
    `oak start: myst.yml changed but could not be composed, so the preview is still showing the ` +
    `previous version: ${message}`,
};

/** `oak build`, `validate` and `start` handing the command to the oak version the paper pins, and
 *  `oak bootstrap` to the one `--engine-version` names. */
export const pinned = {
  running: (
    verb: HandoffVerb,
    pin: PinnedEngine,
    source: PinSource,
    dir: string,
    current: string,
  ): string =>
    `oak ${verb}: running oak ${pin.version} from ${pin.engineRepo}, the version ` +
    `${source.kind === 'paper' ? 'myst.yml pins' : '--engine-version names'} (${dir}). Set ` +
    `OAK_USE_RUNNING=1 to run this oak (${current}).`,

  downloading: (verb: HandoffVerb, pin: PinnedEngine, dir: string): string =>
    `oak ${verb}: downloading oak ${pin.version} from ${pin.engineRepo} into ${dir}.`,

  otherRepo: (
    verb: HandoffVerb,
    pin: PinnedEngine,
    source: PinSource,
    defaultRepo: string,
  ): string =>
    `oak ${verb}: this runs oak ${pin.version} from ${pin.engineRepo} ` +
    `(${source.kind === 'paper' ? 'engine_repo in pins.yml' : '--engine-repo'}), not from ` +
    `${defaultRepo}. Fetching it runs that repository's code on this machine.`,

  badVersion: (verb: HandoffVerb, got: string, where: string): string =>
    `oak ${verb}: the oak version in ${where} is ${JSON.stringify(got.slice(0, 60))}; pin a ` +
    `release tag like v1.2.3 or v1.2.3-dev.4.`,

  badRepo: (verb: HandoffVerb, got: string, source: PinSource): string =>
    `oak ${verb}: ${
      source.kind === 'paper' ? `engine_repo in ${source.pinsPath ?? 'pins.yml'}` : '--engine-repo'
    } must be owner/name, not ${JSON.stringify(got.slice(0, 60))}.`,

  fetchFailed: (verb: HandoffVerb, pin: PinnedEngine, source: PinSource, why: string): string =>
    `oak ${verb}: could not fetch oak ${pin.version} from ${pin.engineRepo} (${why}). Check ` +
    `${source.kind === 'paper' ? 'the version in myst.yml' : '--engine-version'}, or set ` +
    `OAK_USE_RUNNING=1 to run this oak.`,

  noBuild: (verb: HandoffVerb, pin: PinnedEngine, source: PinSource, dir: string): string =>
    `oak ${verb}: ${pin.engineRepo} ${pin.version} has no build (no dist/cli.cjs in ${dir}); ` +
    `${source.kind === 'paper' ? 'pin a release tag in myst.yml' : 'name a release tag'}.`,
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * oak validate: oak's own findings (Layer A) and the notes about how a run happened.
 * The editorial (Layer B) check messages come from the curvenote catalog, not from us.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const validate = {
  /** `oak validate` in the journal repo, as {@link build.inJournalRepo}. */
  inJournalRepo: (root: string): string =>
    `oak validate: ${root} is the journal repo, not a paper; journal.yml holds the journal's ` +
    `settings, and there is no manuscript here to check. The journal's settings are checked by ` +
    `each paper's own build, which reads them.\n` +
    `Run oak validate inside a paper's checkout, or pass --paper <path to the paper>.`,

  verdict: (pass: boolean, counts: string[]): string =>
    `oak validate: ${pass ? 'PASS' : 'FAIL'}${counts.length ? ' (' + counts.join(', ') + ')' : ''}`,

  // ── layout / identity ──────────────────────────────────────────────────────────────────
  missingFile: (file: string): string => `missing required file "${file}" at the paper root`,
  strayMystYml: (path: string): string =>
    `extra myst.yml at "${path}": a paper repo has one, at its root`,
  idMissing: 'project.id is missing',
  idFolderMismatch: (dir: string, id: string): string =>
    `${dir} holds project.id "${id}"; a paper's folder is named by its id, so rename the folder ` +
    `or change the id to match`,
  idFolderBadName: (dir: string): string =>
    `${dir} is not a paper id: a paper folder's name is its id, made of letters, digits, - and _`,

  // ── brand ──────────────────────────────────────────────────────────────────────────────
  brandNoFavicon:
    'brand declares no favicon, so browser tabs show a default icon; set ' +
    '`favicon` in brand.yml (' +
    docsUrl(DOCS.branding) +
    ')',
  brandFaviconUnresolved: (favicon: string): string =>
    `brand favicon "${favicon}" does not resolve to a file`,
  brandNoWatermark:
    'brand declares no watermark image (project.options.logo in brand.yml): the PDF renders ' +
    'without one (' +
    docsUrl(DOCS.pdfLogo) +
    ')',
  brandWatermarkIsUrl: (logo: string): string =>
    `brand watermark "${logo}" is a URL: the PDF renderer cannot fetch it, so it must be a file committed in the journal repo`,
  brandWatermarkUnresolved: (logo: string): string =>
    `brand typst watermark "${logo}" does not resolve to a file`,

  // ── how the run happened (notes: they explain, they never gate) ────────────────────────
  noteDraft:
    'this paper is not listed in registry/papers.yml yet, so the editorial checks report ' +
    'warnings; they block once an editor lists it. The id checks block either way.',
  noteUncomposed:
    "checked the paper's own myst.yml ONLY: the journal's settings were not available to this " +
    'run, so whatever the journal, its edition or its branding add (the cover image, the PDF ' +
    'export) was not checked here.',

  // ── the paper's id (checked against the journal's policy) ──────────────────────────────
  journalMissing: (instanceRoot: string): string =>
    `no journal.yml in ${instanceRoot}, so the journal's own rules (the paper id policy and the ` +
    `editorial checks) could not be loaded and nothing was enforced. Point --instance at the ` +
    `journal repo, or pass --no-instance to validate the paper on its own.`,
  idNoPattern:
    "journal.yml sets no id_pattern, so paper ids are checked only against the engine's own " +
    "template placeholder; set one to enforce the journal's own id convention: " +
    docsUrl(DOCS.idPattern),
  idPlaceholder: (id: string): string =>
    `paper id "${id}" is the template placeholder; every paper needs a fresh unique id: ` +
    `${docsUrl(DOCS.idPattern)}`,
  idPatternMismatch: (id: string, pattern: string): string =>
    `paper id "${id}" does not match the journal id pattern /${pattern}/: ` +
    `${docsUrl(DOCS.idPattern)}`,
  idRegistryUnavailable: (id: string): string =>
    `registry unavailable; cannot check id "${id}" for uniqueness`,
  idMaybeOwnEntry: (id: string, repo: string): string =>
    `paper id "${id}" is registered to ${repo}; cannot confirm it is not this ` +
    `paper's own entry without a repo context`,
  idTaken: (id: string, repo: string): string => `paper id "${id}" already registered to ${repo}`,
  idRegistryMismatch: (registeredId: string, id: string): string =>
    `registry/papers.yml lists this repository as paper "${registeredId}", but myst.yml has ` +
    `project.id "${id}"; change one so they match`,
  registryNotList:
    'registry/papers.yml is not a list of entries, so paper ids were not checked against it: ' +
    docsUrl(DOCS.fileRegistry),
  registryLocationSkipped: (label: string, hint?: string): string =>
    `registry/papers.yml entry "${label}" has a location oak cannot read, so the id checks ` +
    `skipped it; ` +
    (hint
      ? `write "location: ${hint}"`
      : 'write "owner/name" for a GitHub repository or "./path" for a folder in the journal ' +
        'repository'),
  registryEntrySkipped: (label: string): string =>
    `registry/papers.yml entry "${label}" is not a valid entry, so the id checks skipped it: ` +
    docsUrl(DOCS.fileRegistry),

  // ── thumbnail / typst template hygiene ─────────────────────────────────────────────────
  thumbnailUnresolved: (thumbnail: string): string =>
    `thumbnail "${thumbnail}" does not resolve to a file under the paper root; the ` +
    `paper will ship with NO thumbnail (a declared thumbnail disables myst's ` +
    `first-image fallback) and its gallery card renders blank`,
  journalStampSet:
    `myst.yml sets project.options.oaktree-sapling.journal, which oak writes itself when it ` +
    `builds. Remove it from myst.yml.`,
  templateOverride: (authorTemplate: string, journalTemplate?: string): string =>
    `this paper declares its own typst template ("${authorTemplate}"), overriding ` +
    (journalTemplate ? `the journal's ("${journalTemplate}").` : "oaktree-sapling's."),
  templateFloating: (layer: string, value: string): string =>
    `${layer} typst template "${value}" is not pinned, so the file it points to can change ` +
    `without this value changing. Prefer a release URL or a local path. (Published PDFs stay ` +
    `reproducible: the deposit archives the template used.)`,
  templateNameAmbiguous: (journalTemplate: string): string =>
    `journal.yml typst_template "${journalTemplate}" is being used as a myst template ` +
    `NAME, but "${journalTemplate}" also exists in the journal repo. If you meant the ` +
    `directory, write "./${journalTemplate}"; only ./ and ../ values are treated as paths. ` +
    `See ${docsUrl(DOCS.typstTemplate)}`,

  // ── the deposit folder ─────────────────────────────────────────────────────────────────
  depositCollision: (names: string[], reserved: string[]): string =>
    `deposit/ holds ${names.map((n) => `"${n}"`).join(', ')}, which the engine writes into ` +
    `every deposit itself; the release would refuse to publish. Rename them: ` +
    `${reserved.join(', ')} are the engine's.`,

  // ── the extends layers must not race each other ────────────────────────────────────────
  layerExtendsUnreadable: (refs: string): string =>
    `extends layers point at ${refs}, which cannot be read from this checkout, so the keys ` +
    'they declare could not be checked for clashes; extend a local path, or move those keys ' +
    'into the layer itself.',
  layersOverlap: (clashes: string): string =>
    `extends layers declare overlapping keys: ${clashes}; move each key to one layer.`,

  // ── a run that could not compose ───────────────────────────────────────────────────────
  noteComposeFailed: (failure: string): string =>
    `checked the paper's own myst.yml ONLY: it could not be combined with the journal's ` +
    `settings (${failure}), so anything the journal or its edition adds was not checked.`,
  composeFailed: (failure: string): string =>
    `myst.oak.yml could not be composed: ${failure.replace(/\.$/, '')}. The paper's own ` +
    `config caused it, so \`oak build\` fails the same way; the checks below ran on the paper's ` +
    `myst.yml alone, without oak's defaults, the edition or the branding.`,

  editorialLoadFailed: (message: string): string =>
    `could not load the paper project for editorial checks: ${message}`,
  needsBuildArtifacts: 'requires build artifacts; run `oak build` first',
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * `oak papers`: the papers a workflow run works on.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const papers = {
  usage:
    'oak papers: usage: oak papers (--for build|check | --tag <tag> | --id <paper id> | --id-env)',
  tagNamesNoPaper: (tag: string, colocated: boolean): string =>
    `oak papers: tag ${JSON.stringify(tag.slice(0, 80))} names no paper of this repository; ` +
    (colocated
      ? 'tag <paper id>/vX.Y.Z, naming a folder in papers/.'
      : 'tag vX.Y.Z in a paper repository.'),
  idInPaperRepo:
    'oak papers: this is a paper repository, with its one paper at the root; leave the paper id empty.',
  unknownId: (id: string): string =>
    `oak papers: ${JSON.stringify(id.slice(0, 80))} is not one of this repository's papers; ` +
    'give the id its folder in papers/ is named by.',
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * `oak add-paper`: an author's submission of interest to a co-located journal.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const addPaper = {
  usage:
    'oak add-paper: usage: oak add-paper --repo <owner/journal> --id <paper id> [--edition <id>] [--yes]',
  badId: (id: string): string =>
    `oak add-paper: ${JSON.stringify(id.slice(0, 60))} is not a paper id: letters, digits, - and _, ` +
    `starting with a letter or digit. It names the paper's folder, its tags and its Zenodo record.`,
  noEdition: (id: string): string =>
    `oak add-paper: the id ${id} carries no year to take the edition from; pass --edition <id>, ` +
    `one of the journal's editions/<id>.yml.`,
  badEdition: (edition: string): string =>
    `oak add-paper: --edition ${JSON.stringify(edition.slice(0, 60))} is not an edition id (letters, digits, . _ -).`,
  notColocated: (repo: string): string =>
    `oak add-paper: ${repo} has no papers/ folder, so it is not a co-located journal; a paper ` +
    `repository of its own is set up with oak bootstrap paper.`,
  idRefused: (why: string): string => `oak add-paper: ${why}`,
  idTaken: (id: string, repo: string): string =>
    `oak add-paper: ${repo} already has papers/${id}; pick another id. A merged submission claims its id.`,
  unknownEdition: (edition: string, repo: string, given: boolean): string =>
    `oak add-paper: ${repo} has no editions/${edition}.yml` +
    (given ? '' : ', the edition the year in the id names') +
    '; pass --edition naming one of its editions.',
  noEngineVersion: (repo: string): string =>
    `oak add-paper: .github/actions/engine/pins.yml in ${repo} names no engine_version, so the ` +
    `new paper would pin no engine; an editor runs oak upgrade on the journal first.`,
  planHeader: (repo: string, id: string): string => `add-paper ${id} to ${repo}`,
  planEdition: (edition: string, given: boolean): string =>
    `  --edition  ${edition}${given ? '' : ' (default: the year in the id; it can change later, in myst.yml)'}`,
  planFork: (fork: string, branch: string): string =>
    `  ○ fork the journal as ${fork}, if you have no fork yet, and push branch ${branch} to it`,
  planSeed: (dir: string, version: string): string =>
    `  ○ commit the starter manuscript as ${dir}/, pinned to engine ${version}`,
  planPr: (repo: string): string =>
    `  ○ open a pull request to ${repo}: an editor merges it as a draft, which the website does not show yet`,
  aborted: 'nothing was forked, pushed or opened.',
  commitMessage: (id: string): string => `feat: add ${id}`,
  logPushed: (fork: string, branch: string): string => `  ✓ pushed ${branch} to ${fork}`,
  logPrOpened: (url: string): string => `  ✓ opened ${url}`,
  prTitle: (id: string): string => `Submission of interest: ${id}`,
  prBody: (id: string, dir: string): string =>
    [
      `Adds \`${dir}/\`, the starter manuscript for \`${id}\`. Merging it adds the paper as a draft: ` +
        `it is on main, and the website shows it once an editor lists it in \`registry/papers.yml\`.`,
      '',
      'Until then the editorial checks report warnings; the id checks must pass. Later changes ' +
        'come as pull requests that change this folder only.',
    ].join('\n'),
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * `oak assemble`: the journal website of a co-located repository, with its papers mounted.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const assemble = {
  usage: 'oak assemble: usage: oak assemble --builds <folder of paper builds> [--base-url <path>]',
  badBuildFolder: (name: string): string =>
    `oak assemble: ${JSON.stringify(name.slice(0, 80))} is not a paper build; each folder is ` +
    `named paper-build-<paper id>, as the Build paper workflow uploads it.`,
  registryNotList:
    'oak assemble: registry/papers.yml is not a list of entries, so no paper could be mounted: ' +
    docsUrl(DOCS.fileRegistry),
  missingBuilds: (ids: string[]): string =>
    `oak assemble: registry/papers.yml lists ${ids.join(', ')}, with no build; a listed paper ` +
    `that does not build holds back the website, which keeps its last deployment.`,
  unlisted: (id: string): string =>
    `oak assemble: ${id} is built but not listed in registry/papers.yml, so it is left out.`,
  noSite: (html: string): string =>
    `oak assemble: the journal website built no ${html}/index.html; check pages/ and the toc in myst.yml.`,
  clash: (id: string): string =>
    `oak assemble: the journal website already serves /${id}/, so paper ${id} cannot be mounted ` +
    `there; rename the website's page or folder.`,
  mounted: (id: string, path: string): string => `oak assemble: ${id} at ${path}`,
  stepFailed: (command: string, status: number | null): string =>
    `oak assemble: ${command} failed (exit ${status ?? 'signal'}) building the journal website; its output is above.`,
  galleryNotLoaded:
    'oak assemble: the gallery plugin did not load: check the pinned plugin URL in myst.yml (a bad tag 404s silently).',
  fileUnresolved:
    'oak assemble: a file in the config did not resolve: paths in brand/brand.yml start at the repo root, as in brand/logo.svg.',
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * What an author reads on their pull request: the comments and the Check Run. These are the
 * bodies; {@link stickyMarker} goes above them.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** The hidden first line of a comment oak edits in place. `realGhPr.sticky` (gh.ts) finds the
 *  comment by it, so it must not change. */
export function stickyMarker(header: string): string {
  return `<!-- oak-sticky: ${header} -->`;
}

export const pr = {
  previewDeployed: (url: string, paper?: string): string =>
    [
      paper ? `**Preview of \`${paper}\` deployed** 🚀` : '**Preview deployed** 🚀',
      '',
      `${url}`,
      '',
      '_Updated on every push to this pull request._',
    ].join('\n'),

  previewArtifact: (runUrl: string, reason: string, paper?: string): string =>
    [
      paper ? `**Preview build of \`${paper}\` ready** 📦` : '**Preview build ready** 📦',
      '',
      'No Cloudflare preview is configured, so the built site is attached to its "Build paper" run as',
      `the **${paper ? `paper-build-${paper}` : 'paper-build'}** artifact; open the run and scroll to **Artifacts**: ${runUrl}`,
      '',
      `_(${reason}.)_`,
    ].join('\n'),

  newVersionReminder: (doi: string, recordUrl: string, paper?: string): string =>
    [
      paper
        ? `**Zenodo new-version reminder for \`${paper}\`**`
        : '**Zenodo new-version reminder**',
      '',
      'This paper is already published on Zenodo. Before tagging the next release, an editor must:',
      '',
      `1. Open the record: ${recordUrl}`,
      '2. Click **New version** to create an empty draft.',
      '',
      `Pushing the new \`${paper ? `${paper}/v*` : 'v*'}\` tag fills that draft. The editor then clicks **Publish** on Zenodo.`,
      '',
      `Concept DOI: \`${doi}\``,
    ].join('\n'),

  checksHeadline: (pass: boolean, title: string): string =>
    `### ${pass ? '✅' : '❌'} ${pass ? 'Journal checks passed' : 'Journal checks failed'}: ${title}`,
  checksFooter: `[What these checks are](${docsUrl(DOCS.checks)}) · _Updated on every push to this pull request._`,
  checkRunTitle: (passed: number, failed: number, warnings: number): string =>
    `${passed} passed, ${failed} failed` +
    (warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''),
  checkRunTitleShimTouched: (title: string): string => `⚠️ CI workflows modified: ${title}`,
  checkRunTitleShimUnlisted: (title: string): string => `⚠️ CI workflows may be modified: ${title}`,
  unknownCheckId: (id: string): string =>
    `unknown check id "${id}"; the ids the journal can ask for, and how to change the set: ` +
    `${docsUrl(DOCS.checksChanging)}`,
  checkTableHeader: '| Check | Status | Detail |\n| --- | --- | --- |',
  checkTableRow: (id: string, status: string, optional: boolean, detail: string): string =>
    `| ${id} | ${status}${optional ? ' (optional)' : ''} | ${detail} |`,
  checkRunNote: (note: string): string => `> ⚠️ ${note}`,
  shimMore: (n: number): string => `, +${n} more`,

  // ── several papers in one repository ───────────────────────────────────────────────────
  /** The comment's line naming the papers a pull request changes. */
  checksPapers: (ids: string[]): string =>
    `Paper${ids.length === 1 ? '' : 's'} this pull request changes: ${ids.map((i) => `\`${i}\``).join(', ')}`,
  checksNoPaper: 'This pull request changes no paper.',
  /** A section of the combined Check Run for one paper. */
  checksPaperSection: (id: string, title: string): string => `#### \`${id}\`: ${title}`,
  checkRunTitlePapers: (titles: string[]): string => titles.join('; '),
  checkRunTitleNoPaper: 'no paper changed',
  forkRefusedTitle: 'refused: a pull request from a fork changes one paper',
  forkUnlisted:
    'GitHub did not list every file this pull request changes, so oak cannot tell that it ' +
    'changes one paper only.',
  forkOutsidePapers: (files: string[]): string =>
    `A pull request from a fork changes files in one papers/<id>/ folder and nowhere else; ` +
    `this one also changes ${files
      .slice(0, 5)
      .map((f) => `\`${f}\``)
      .join(', ')}${files.length > 5 ? `, +${files.length - 5} more` : ''}.`,
  forkNoPaper: 'A pull request from a fork changes one papers/<id>/ folder; this one changes none.',
  forkSeveralPapers: (papers: string[]): string =>
    `A pull request from a fork changes one paper; this one changes ` +
    `${papers.map((p) => `\`${p}\``).join(', ')}. Open one pull request per paper.`,
  forkWrongReport: (expected: string, got: string[]): string =>
    `This pull request changes \`${expected}\`, but its checks report covers ` +
    `${got.length ? got.map((p) => `\`${p}\``).join(', ') : 'no paper'}; the report was not ` +
    `made for this change.`,

  /** A pull request that edits the files the checks run from. A warning, never a failure:
   *  upgrade pull requests edit them too. */
  shimWarning: (shown: string, more: string): string =>
    `> ⚠️ **This pull request changes the files that run the checks** (${shown}${more}). ` +
    `The results below come from its own copy of them, so they may not be the journal's ` +
    `checks. Unless this is an oak upgrade, an editor should read those changes before ` +
    `trusting the report.`,
  /** A pull request whose changed files GitHub did not list in full, so gated ones may hide. */
  shimWarningUnlisted: (paths: string[]): string =>
    `> ⚠️ **GitHub did not list every file this pull request changes**, so it may change the ` +
    `files that run the checks (${paths.join(', ')}). An editor should read its changes to ` +
    `those files before trusting the report.`,
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The workflow-run verbs (deposit / release / preview / notify / post-checks / conformance).
 * Mostly read in a CI log, but every one of them can be typed by hand.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const workflow = {
  // deposit
  depositUsage: 'oak deposit: usage: oak deposit <prepare|publish|status> [...]',
  depositUnknownPaper: (dir: string): string =>
    `oak deposit: ${dir} is not one of this repository's papers (papers/<id>/myst.yml); name a paper by its folder.`,
  badPaperFolder: (dir: string): string =>
    `${dir} holds a myst.yml but is not named by a paper id (letters, digits, - and _, starting ` +
    `with a letter or digit); rename the folder to the paper's project.id.`,
  badPaperId: (source: string, got: string): string =>
    `${source} takes a paper id (letters, digits, - and _), not ${JSON.stringify(got.slice(0, 60))}.`,
  badRepoName: (source: string, got: string): string =>
    `${source} takes a GitHub repo as owner/name, not ${JSON.stringify(got.slice(0, 60))}.`,

  /** `why` is the reading error, which names journal.yml (yaml-io.ts `readJournalConfig`). */
  previewBadJournal: (why: string): string =>
    `${why} Until then the preview falls back to an artifact link; nothing else in this run ` +
    `depends on it`,

  postChecksPrsDiffer: (prs: string[]): string =>
    `oak post-checks: the reports name different pull requests (${prs.join(', ')}). They come ` +
    `from the pull_request job's artifacts, which are corrupt or hostile; nothing was posted.`,
  postChecksBadReport: (path: string): string =>
    `${path} is not a checks report (no checkRun.conclusion). It comes from the ` +
    `pull_request job's artifact, which is truncated, corrupt or hostile; nothing was posted.`,

  previewNoSite: (dir: string): string =>
    `oak deploy-preview: no built site in ${dir}; this pull request builds no paper, so there is no preview.`,
  previewBadPrNumber: (got: string): string =>
    `.pr-number is not a pull request number (${JSON.stringify(got.slice(0, 40))}). It ` +
    `comes from the build artifact, which is corrupt or hostile.`,
  badPaperDir: (got: string): string =>
    `the paper folder ${JSON.stringify(got.slice(0, 60))} is not a folder below the repo root ` +
    `(letters, digits, . _ - and /, no part starting with a dot). If it came from a build ` +
    `artifact, the artifact is corrupt or hostile.`,
  paperDirMismatch: (artifact: string, flagged: string): string =>
    `the build artifact names the paper ${artifact} but --paper is ${flagged}; refusing to ` +
    `post for either. Check the paper-dir the workflow passes.`,

  // the pull request check before Stage 2 writes to a pull request
  prCheckNoRepo: (pr: string): string =>
    `cannot check pull request #${pr}: no repo. Pass --repo <owner/name> or set GITHUB_REPOSITORY.`,
  prCheckNoHead: (pr: string): string =>
    `cannot check pull request #${pr}: no commit to compare its head with. Pass ` +
    `--verified-head <sha> (a workflow_run run reads it from the event).`,
  prHeadMismatch: (pr: string, actual: string, built: string): string =>
    `pull request #${pr} heads at ${actual}, not at ${built}, the commit this run built; ` +
    `refusing to post. A newer push gets its own run.`,

  depositNoToken: (sandbox: boolean): string =>
    sandbox
      ? 'oak deposit: --sandbox needs ZENODO_TOKEN_SANDBOX (an environment secret on ' +
        'zenodo-prepare) or --token. A sandbox run never falls back to the production token.'
      : 'oak deposit: no token. Set ZENODO_TOKEN or pass --token.',
  depositNoRepo: 'deposit prepare: pass --repo owner/repo (or set GITHUB_REPOSITORY)',
  depositBadGithubUrl: (mystPath: string, got: string): string =>
    `project.github in ${mystPath} is not a github.com repo URL ` +
    `(${JSON.stringify(got.slice(0, 80))}). Set it to https://github.com/<owner>/<repo>.`,
  depositPublishArgs: 'deposit publish: --pdf and --tag are required',
  depositDoiPrOpened: (url: string): string => `deposit prepare: opened DOI PR ${url}`,
  depositDoiPrFailed: (message: string): string =>
    `deposit prepare: DOI PR not opened (${message})`,

  // journal.zip: the journal commit the build recorded in myst.oak.yml
  depositJournalUnstamped:
    `myst.oak.yml does not say which journal commit the PDF was built from, so the deposit ` +
    `cannot archive it. Build this working tree with oak before depositing.`,
  depositJournalUncommitted:
    `the PDF was built from journal files that are not a commit of their own repo (local ` +
    `changes, a folder inside a larger repo, or not a git checkout), so the deposit cannot ` +
    `archive them. Build again from a clean clone of the journal repo.`,
  depositJournalNotGiven: (at: string): string =>
    `the PDF was built from the journal at ${at}. Pass --instance <a clone of that repo> so ` +
    `the deposit can archive it.`,
  depositJournalOtherRepo: (built: string, given: string): string =>
    `the PDF was built from the journal ${built}, but --instance is a clone of ${given}. Pass a ` +
    `clone of ${built}.`,
  depositJournalUnfetchable: (at: string, why: string): string =>
    `the journal commit the PDF was built from (${at}) could not be fetched (${why}). Re-run ` +
    `the whole workflow, so the build and the deposit read the same journal commit.`,

  /** The DOI pull request `gh.openDoiPr` opens. GitHub holds the checks on a pull request a
   *  workflow opens, and approving them does not run the preview, so the body says what the
   *  editor clicks. */
  doiPrTitle: (paper?: string): string =>
    paper ? `Reserve Zenodo DOI for ${paper}` : 'Reserve Zenodo DOI',
  doiPrBody: (conceptDoi: string, mystPath = 'myst.yml'): string =>
    [
      `Writes the reserved concept DOI \`${conceptDoi}\` into \`${mystPath}\`. Merge before tagging.`,
      '',
      '<details>',
      '<summary>Why are the checks waiting?</summary>',
      '',
      'GitHub holds the checks on a pull request a workflow opens, and approving them does not ' +
        'run the preview. To run the Journal checks and the preview, close and reopen this pull ' +
        'request.',
      '',
      '</details>',
    ].join('\n'),

  // release
  releaseNoTag: 'oak release: --tag vX.Y.Z is required',
  releaseBadTag: (tag: string): string =>
    `oak release: tag ${JSON.stringify(tag.slice(0, 80))} is not a version tag; tag vX.Y.Z in a ` +
    `paper repository, or <paper id>/vX.Y.Z for papers/<paper id> in a co-located one.`,
  releaseNoPaperFolder: (tag: string, dir: string): string =>
    `oak release: tag ${tag} names ${dir}, which holds no paper (no myst.yml); delete the tag and ` +
    `tag the paper by the name of its folder.`,
  releaseTagOtherPaper: (tag: string, paper: string): string =>
    `oak release: tag ${tag} names another paper than --paper ${paper}; a tag releases the paper it names.`,
  releaseNoDoi: 'oak release: project.doi missing; run prepare and merge that pull request first.',
  notZenodoDoi: (doi: string): string =>
    `project.doi ${doi} is not a Zenodo DOI; write it as 10.5281/zenodo.<id>, or ` +
    `10.5072/zenodo.<id> from the sandbox`,
  releaseNotZenodoDoi: (doi: string): string => `oak release: ${workflow.notZenodoDoi(doi)}`,
  releaseNoToken: (sandbox: boolean): string =>
    `no token: set ${sandbox ? 'ZENODO_TOKEN_SANDBOX' : 'ZENODO_TOKEN'}`,
  releaseNoPdf: 'oak release: no PDF under _build/exports (did the typst export run?)',
  releasePostStepsFailed: (message: string): string =>
    `oak release: uploading to the GitHub release or commenting failed (${message})`,
  releaseCommitComment: (draft: string): string => `Zenodo draft populated: ${draft}`,
  releaseFailureIssue: (tag: string): string => `Zenodo publish failed for ${tag}`,

  // preview / notify
  previewProviderIsNot: (provider: string): string => `preview.provider is '${provider}'`,
  previewNoCloudflareSecrets: 'Cloudflare secrets are not configured',
  previewNoProjectName: 'preview.cf_project_name is unset in journal.yml',
  previewNoPrNumberReason: 'no .pr-number in artifact',
  previewCloudflareFailedReason: (message: string): string => `cloudflare-failed: ${message}`,
  cloudflareDegraded: (message: string): string =>
    `deploy-preview: Cloudflare deploy failed, linking the build artifact instead (${message})`,
  cloudflareDegradedReason: (message: string): string => `Cloudflare deploy failed: ${message}`,
  noPrNumber: 'deploy-preview: no .pr-number in artifact; nothing to preview.',
  previewStripped: (names: string[]): string =>
    `deploy-preview: removed Cloudflare Pages control files before serving (${names.join(', ')}).`,
  notifyUsage: 'oak notify: usage: oak notify new-version [--pr N | --site <dir>]',
  notifyNoPr: 'oak notify new-version: pass --pr N (or --site <dir> holding a .pr-number)',
  notifyPublishedButUnlinked:
    'notify: a version tag (vX.Y.Z) exists but project.doi is missing from myst.yml; the ' +
    'repo is published but unlinked. Fix myst.yml before tagging the next release.',
  notifyRecordUrlFailed: (why: string): string => `notify: ${why}`,
  notifyBadDoi: (doi: string): string =>
    `not a Zenodo DOI: ${doi} (expected 10.5281/zenodo.* or 10.5072/zenodo.*)`,
  notifyFirstDeposit: 'no version tags (vX.Y.Z) yet (first-deposit case)',
  notifyTagsFailed: (why: string): string =>
    `notify: gh could not list the repo's version tags (${why}); whether the paper is ` +
    'already published is unknown, and the reminder is not skipped on a guess.',

  // post-checks
  postChecksArgs:
    'oak post-checks: --report <path>, --repo <owner/repo>, --sha <headsha>, --base <branch> ' +
    'and --verified-head <headsha> are required',
  postChecksNoReport: (path: string): string => `oak post-checks: report file not found: ${path}`,
  postChecksCheckRunFailed: (message: string): string =>
    `post-checks: Check Run not posted (${message})`,
  postChecksCommentFailed: (message: string): string =>
    `post-checks: comment not posted (${message})`,

  // validate's own failure report (what post-checks posts when the run could not happen)
  validateCouldNotRun: 'oak validate could not run',
  validateCrashed: 'oak validate crashed',
  validateCrashLine: (details: string): string => `oak validate: ${details}`,
  validateReportNotWritten: (path: string): string =>
    `oak validate: could not write the report to ${path}`,

  // bootstrap / conformance argument errors
  bootstrapNoRepo: 'oak bootstrap: --repo <owner/name> is required',
  bootstrapBadEngineVersion: (got: string): string =>
    `oak bootstrap: --engine-version must be a release tag like v1.2.0 or v1.2.0-dev.4, got: ${got}`,
  /** A dev tag can be deleted, which breaks the repos pinned to it, so it is pinned only when
   *  named. */
  bootstrapUnreleased: (running: string): string =>
    `oak bootstrap: the running oak (${running}) is not a stable release, so there is no ` +
    'default to pin. Pass --engine-version <tag> to name one (v1.2.0, or a pre-release like ' +
    'v1.2.0-dev.4); the files still come from the running oak.',
  bootstrapUsage: 'oak bootstrap: usage: oak bootstrap <paper|journal> --repo <owner/name> [...]',
  bootstrapSecretsNeedPaper:
    'oak bootstrap journal: the secret flags (--zenodo-token, ' +
    '--zenodo-token-sandbox, --cf-token, --cf-account) set nothing here; this repo holds ' +
    "the journal's settings and runs no publishing, so it takes no secrets. The tokens are " +
    'set per paper repo: `oak bootstrap paper` accepts the same flags, or set them in the ' +
    "paper repo's environment settings.",
  conformanceResetArgs: 'oak conformance reset: --repo <owner/name> is required',
  conformanceRunArgs: 'oak conformance run: --repo <owner/name> and --tag <vX.Y.Z> are required',
  conformanceUsage:
    'oak conformance: usage:\n' +
    '  oak conformance reset --repo <owner/name>\n' +
    '  oak conformance run   --repo <owner/name> --tag <vX.Y.Z> [--run-id <id>] [--fork-repo <owner/name>] [--record <path>]',

  /** Printed while a git/gh call is in flight, then erased; see gh.ts `showWorking`. */
  working: (what: string): string => `  … ${what}`,

  // the release lookup and the wrangler deploy (gh.ts)
  noStableRelease: (engineRepo: string): string =>
    `no stable release on ${engineRepo} to move to. Pass --to <tag> to name one; ` +
    `pre-releases are excluded from "latest" on purpose, since a dev tag can be deleted.`,
  /** Thrown by `realGhPr.sticky` (gh.ts) when it cannot tell which repo to post to. */
  noOriginRepo: (repoRoot: string): string =>
    `no github.com origin remote in ${repoRoot}, so there is no repo to post to`,
  /** The DOI pull request must change one file against the default branch. */
  doiPrDiverged: (head: string, base: string): string =>
    `${head} carries commits that are not on ${base}, so the DOI pull request would not be ` +
    `the one-file change it claims to be. Run prepare on ${base}.`,
  wranglerNoUrl: 'wrangler did not report a *.pages.dev deployment URL',
  /** No detail from wrangler: this reaches a public pull request comment, and wrangler's output
   *  names the account id. The details stay in the workflow log, where Actions redacts
   *  secrets. */
  wranglerFailed: 'wrangler could not deploy the preview; see the workflow log for its output',
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Last resort
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** A bug in oak: say so, then show the stack. */
export const engineCrash = (stack: string): string =>
  `oak: unexpected error. This is a bug in oak, not something you did ` +
  `wrong; the details below are what to report.\n${stack}`;
