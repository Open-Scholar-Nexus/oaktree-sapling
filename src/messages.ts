/**
 * The strings oak prints for people, grouped by where they appear: the output helpers, then
 * usage, the confirm prompt, bootstrap, upgrade, build and start, validate, what lands on a pull
 * request, and the verbs the workflows run.
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
 *   templates/paper/.github/workflows/*.yml . job names and `::error::` annotations (ci, check,
 *                                             check-post, preview-deploy, prepare, publish,
 *                                             version-bump: the names show in the Actions tab)
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Output plumbing: not prose, but it decides HOW the prose is printed.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** Are we inside a GitHub Actions run? Annotations mean something only there. */
export function inCI(): boolean {
  return Boolean(process.env.GITHUB_ACTIONS ?? process.env.CI);
}

/**
 * A warning or error line. `::warning::…` becomes an annotation in a workflow log and is noise in
 * a terminal, so it is added only in CI. There a message is escaped, since a raw newline cuts the
 * annotation at its first line.
 */
export function annotate(kind: 'warning' | 'error', message: string): string {
  if (!inCI()) return kind === 'warning' ? `warning: ${message}` : message;
  return `::${kind}::${message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`;
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
 * It opens with what oak is and where to start. `--external` and `--co-located` get a sentence
 * each, since the flag names do not explain the choice.
 */
export const usage = (): string =>
  `oak: a mystmd-based engine for running a small journal. It sets up the journal\n` +
  `(its branding, editions and list of papers) and the repos its papers live in, then\n` +
  `builds, checks, previews and publishes each paper with the journal's settings. It\n` +
  `drives git and gh (the GitHub CLI) under the hood; anything that changes a repo\n` +
  `prints a plan and asks before it does it.\n` +
  `\n` +
  `Starting from nothing? Create the journal, then a repo per paper:\n` +
  `  oak bootstrap journal --repo <owner/name> --external --name "My Journal" --edition 2026\n` +
  `  oak bootstrap paper   --repo <owner/name> --instance <owner/journal-repo> --edition 2026\n` +
  `\n` +
  `Setting up repos\n` +
  `  oak bootstrap journal --repo <owner/name> (--external | --co-located) [--name <name>] [--edition <id>]\n` +
  `                        [--engine-repo <owner/name>] [--engine-version <tag>] [--owner <@user|@org/team>]\n` +
  `                        [--no-require-checks] [--no-site] [--yes]\n` +
  `      --external    the journal gets its own public repo, holding its settings, branding\n` +
  `                    and the list of published papers; each paper then lives in a repo of\n` +
  `                    its own that points back at it. This is the usual choice.\n` +
  `      --co-located  experimental: one repo holds the journal and its single paper\n` +
  `                    together, with no journal website.\n` +
  `  oak bootstrap paper   --repo <owner/name> --instance <owner/journal-repo> --edition <id>\n` +
  `                        [--from <author-url> [--source-ref <ref>]]\n` +
  `                        [--engine-repo <owner/name>] [--engine-version <tag>] [--owner <@user|@org/team>]\n` +
  `                        [--private] [--no-require-checks] [--yes]\n` +
  `      --instance    the journal repo this paper belongs to ('.' only if the journal\n` +
  `                    settings live in this same repo); --edition names one of its editions\n` +
  `  oak upgrade (--repo <owner/name> | --paper <dir>) [--to <tag>] [--version-only|--files-only|--both] [--yes]\n` +
  `                    move a paper repo to a newer engine version, as a pull request\n` +
  `\n` +
  `Working on a paper\n` +
  `  oak validate [--paper <dir>] [--instance <dir> | --no-instance] [--strict] [--report <path>]\n` +
  `                    run the journal's checks over a manuscript and report what fails\n` +
  `  oak build   [--paper <dir>] [--instance <dir> | --no-instance] [--base-url <url>] [--no-site-template]\n` +
  `                    build the paper's website + PDF into _build/\n` +
  `  oak start   [--paper <dir>] [--instance <dir> | --no-instance] [--port <n>] [--server-port <n>]\n` +
  `                    run mystmd's live preview of the paper, with the journal's settings\n` +
  `                    and branding applied (the same config its CI builds). Reloads as you\n` +
  `                    edit; Ctrl-C stops it. Run in the journal repo, it previews the\n` +
  `                    journal website instead.\n` +
  `\n` +
  `Run by the workflows (rarely typed by hand)\n` +
  `  oak check-post --report <path> --repo <owner/repo> --sha <headsha> --base <branch>\n` +
  `                 --verified-head <headsha> [--pr <n>]\n` +
  `  oak deploy-preview <site> [--instance <dir>] [--repo <owner/repo>]\n` +
  `  oak notify new-version [--pr <n> | --site <dir>] [--repo <owner/repo>]\n` +
  `  oak deposit prepare --repo <owner/repo> [--site-url <url>] [--sandbox] [--instance <dir>]\n` +
  `  oak deposit publish --pdf <path> --tag <vX.Y.Z> [--site-url <url>] [--sandbox] [--instance <dir>]\n` +
  `  oak deposit status  [--sandbox] [--instance <dir>]\n` +
  `  oak release --tag <vX.Y.Z> [--no-build] [--paper <dir>] [--instance <dir>] [--site-url <url>]\n` +
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
 * The plan's opening block: every value the run will use, and whether it came from a flag or a
 * default. Most end up in files that are awkward to change later, so `Proceed? [y/N]` covers
 * them all.
 */
export const declared = {
  journalRepoCoLocated: 'this repo itself (--instance .)',
  journalRepo: (repo: string): string => `${repo}: the journal this paper belongs to (--instance)`,

  journalNameGiven: (name: string): string => `${name} (--name)`,
  journalNameDefault:
    'not given; journal.yml, brand/brand.yml and the edition file keep the "CHANGE-ME ' +
    'Journal" placeholder (set it now with --name "Your Journal")',

  editionGiven: (edition: string): string => `${edition} (--edition)`,
  editionDefault: (edition: string): string =>
    `${edition} (placeholder; no --edition given). The scaffold writes editions/${edition}.yml ` +
    `and every paper must name the same id (pass --edition 2026, say, to use your own)`,

  engineVersionGiven: (tag: string): string => `${tag} (--engine-version)`,
  engineVersionDefault: (tag: string): string =>
    `${tag}: the newest engine release right now, no --engine-version given ` +
    `(pass one to pin a version you have tested)`,

  engineRepoGiven: (repo: string): string => `${repo} (--engine-repo)`,
  engineRepoDefault: (repo: string): string =>
    `${repo}: built-in default, no --engine-repo given (where the workflows fetch the engine from)`,

  ownerGiven: (owner: string): string =>
    `${owner} (--owner); written into CODEOWNERS, so this is who must approve changes`,
  ownerDefault: (owner: string): string =>
    `${owner}: your own GitHub login, no --owner given; written into CODEOWNERS, so this ` +
    `is who must approve changes (pass --owner @org/team for a team)`,

  /** Row labels, in the order they print. */
  labels: {
    journalRepo: 'journal repo',
    journalName: 'journal name',
    edition: 'edition',
    engineVersion: 'engine version',
    engineRepo: 'engine repo',
    owner: 'review owner',
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
    '--no-site is only meaningful with --external: a co-located journal never gets a ' +
    'website (an index over many papers in one repo is separate, unbuilt work).',

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
    `bootstrap journal (${external ? 'its own repo; papers live elsewhere' : 'journal and paper in one repo'}): ${repo}`,

  planRepoExists: '  ✓ repo exists',
  planCreateRepo: (isPrivate: boolean): string =>
    `  ○ create repo (${isPrivate ? 'private' : 'public'})`,
  planCreateJournalRepo: (external: boolean): string =>
    `  ○ create repo (public${external ? '; it must stay public: every paper build reads the journal settings from it, without a token' : ''})`,
  planPrivate:
    "  ! on GitHub's free plan a private repo cannot have repo rulesets or Pages, so those " +
    'steps will fail late in this run (403), after the repo and its content are already in ' +
    'place. Create the repo public, or confirm your GitHub plan covers private repos, before ' +
    'proceeding.',

  planMainSeeded: '  ✓ main seeded',
  planSeedPaper:
    '  ○ seed main with the starter manuscript + the GitHub Actions workflows that build and check it',
  planSeedJournal: (withSite: boolean): string =>
    `  ○ seed main with the journal's settings, branding and paper list${withSite ? ', plus the journal website' : ''} (no paper workflows; this repo publishes nothing itself)`,
  planSeedCoLocated:
    "  ○ seed main with the journal's settings AND a starter paper, plus the workflows that build and check it",

  /** A rerun that changes an answer does not reseed, so it would succeed while changing
   *  nothing. */
  planAlreadySeededPaper: (instanceRepo: string): string =>
    `  ! main is already seeded; this run will NOT rewrite the workflows or` +
    ` .github/actions/engine/pins.yml, so the journal repo and engine version an earlier` +
    ` bootstrap wrote stay as they are (this run would have set instance_repo:` +
    ` ${instanceRepo}). To change them, run \`oak upgrade\` or edit` +
    ` .github/actions/engine/pins.yml in a pull request.`,
  planAlreadySeededJournal:
    '  ! main is already seeded; this run will NOT rewrite the files there, so a changed' +
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
    '  ○ repo settings: branch + tag rules, GitHub Pages and the repo website link, the zenodo-publish ' +
    'environment (v* tags only) and the main-only zenodo-prepare and preview ones, permission for Actions ' +
    'to open pull requests, issue labels (safe to re-run)',
  planProvisioningCoLocated:
    '  ○ repo settings: branch + tag rules, GitHub Pages and the repo website link, the zenodo-publish ' +
    'environment (v* tags only) and the main-only zenodo-prepare and preview ones, permission for Actions ' +
    'to open pull requests, issue labels',
  planSecrets: (names: string): string =>
    `  ○ secrets: ${names || 'none given; you get a list of what to set by hand'}`,
  planPages: (siteUrl: string): string =>
    `  ○ turn on GitHub Pages for the journal website (${siteUrl}) and link it from the repo page; no branch rules, no environments`,
  planNoSite: '  ○ (--no-site: settings only; no website, no branch rules, no environments)',

  // ── the issue labels oak creates, shown in the repo's labels list ──────────────────────
  labelEditorAction: 'An editor must take action before this can proceed',
  labelZenodoFailed: 'A Zenodo publish run failed and needs editor attention',

  // ── the repo descriptions, shown on GitHub ─────────────────────────────────────────────
  descriptionPaper: 'A paper, created by `oak bootstrap paper`',
  descriptionJournal:
    'Journal settings, branding and paper list, created by `oak bootstrap journal`',
  descriptionCoLocated:
    'Journal and paper in one repo, created by `oak bootstrap journal --co-located`',

  // ── the running log ────────────────────────────────────────────────────────────────────
  logCreated: (repo: string): string => `  ✓ created ${repo}`,
  logCreatedPublic: (repo: string): string => `  ✓ created ${repo} (public)`,
  logMadePublic:
    '  ✓ made the repo public (paper builds read these settings from here with no token)',
  logSeeded: '  ✓ seeded main',
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
    `  ✓ created tag rule '${name}': only editors can create the v* tags that publish a version`,
  logPagesExists: '  ✓ GitHub Pages already enabled',
  logPagesEnabled: '  ✓ GitHub Pages enabled (published by a workflow)',
  logHomepageExists: (url: string): string => `  ✓ repo website link already set (${url})`,
  logHomepageSet: (url: string): string =>
    `  ✓ repo website link set to ${url} (shown under About on the repo page)`,
  logActionsPrsExists: '  ✓ Actions may already open pull requests',
  logActionsPrsAllowed:
    '  ✓ Actions allowed to open pull requests (the DOI write-back is one of them)',
  logZenodoEnvExists:
    "  ✓ the 'zenodo-publish' environment already restricts its secrets to v* tags",
  logZenodoEnvCreated:
    "  ✓ created the 'zenodo-publish' environment: only v* tags may use its secrets",
  logMainEnvExists: (env: string): string =>
    `  ✓ the '${env}' environment already restricts its secrets to main`,
  logMainEnvCreated: (env: string): string =>
    `  ✓ created the '${env}' environment: only main may use its secrets`,
  logSecretSet: (name: string, env: string): string => `  ✓ secret ${name} set on '${env}'`,
  logRepoSecretDeleted: (name: string): string =>
    `  ✓ deleted the repository secret ${name}; its environments hold it now`,
  logSiteAdded: (siteUrl: string): string => `  ✓ journal website added: ${siteUrl}`,
  logStepFailed: (step: string, why: string): string => `  ✗ ${step} failed: ${why}`,
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

  runbookStartHere: (repo: string): string =>
    `Start here: edit journal.yml (your journal's name and the rules papers are checked against) ` +
    `and brand/ (logo + colours). Papers read both at build time, so a change here reaches ` +
    `every paper's next build. Clone it with: git clone https://github.com/${repo}.git\n` +
    `The whole first pass, in order: ${docsUrl(DOCS.journalStart)}`,

  runbookNoProtection:
    'This repo has no branch protection: adding a paper to the list, or changing the branding, ' +
    'is an ordinary commit or pull request. If you want those changes reviewed, add a branch ' +
    'protection rule yourself.',

  runbookSite: (siteUrl: string): string =>
    `The journal website is built from this repo and goes live at ${siteUrl} once the first ` +
    '"Journal site" workflow run finishes (watch it in the Actions tab). GitHub Pages takes a ' +
    'minute or two to serve a new site, so a 404 immediately after this command is normal. Every ' +
    'file in it is yours to edit: oak writes them once and never again, so an upgrade will not ' +
    'overwrite your design. Three version pins you bump by hand when you want newer: the gallery plugin URL ' +
    'and `site.template` in myst.yml, and `mystmd` in package.json. What each one moves, and ' +
    'how to tell a bump worked: ' +
    docsUrl(DOCS.pins),

  runbookSiteFailure:
    'If a website build ever fails, the version already published keeps serving; a bad entry ' +
    'in registry/papers.yml (the list of published papers) cannot take the journal offline. ' +
    'Fix the entry and push again.',
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
    `kept ${pin}: it is newer than ${target} (the newest release of ${engineRepo}) or is a ` +
    `branch or commit; no pull request. Pass --to <tag> to move it.`,

  planHeader: (repoRoot: string, target: string): string => `upgrade ${repoRoot} → ${target}`,
  planTarget: (target: string, engineRepo: string, targetGiven: boolean): string =>
    `  engine version : ${target}${
      targetGiven
        ? ' (--to)'
        : `: the newest release of ${engineRepo} right now, no --to given (pass --to <tag> to pick one)`
    }`,
  planBumpVersion: (from: string, target: string): string =>
    `  ○ set the engine version in myst.yml: ${from || '(unset)'} → ${target}`,
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
  prBodyVersion: (target: string): string =>
    `- sets \`project.options.oaktree-sapling.version\` → \`${target}\` in myst.yml`,
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

export const build = {
  done: (id: string): string => `oak build: done (id=${id})`,

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

  badEdition: (got: string, mystPath: string): string =>
    `project.options.oaktree-sapling.edition is ${JSON.stringify(got.slice(0, 40))} in ${mystPath}. ` +
    `It names a file (editions/<edition>.yml), so it must be a plain name: letters, digits, . _ -`,
  /** No journal repo found. In CI that means `instance_repo: .` with no journal.yml beside the
   *  paper, so the text explains both values of `instance_repo`, not only a flag. */
  noInstance: (verb: 'build' | 'start' | 'validate', paperRoot: string): string =>
    `oak ${verb}: no journal repo found; ` +
    `pass --instance <path> (or --no-instance for ` +
    `${verb === 'validate' ? 'a bare, engine-only check' : verb === 'start' ? 'an unbranded preview' : 'an unbranded build'}).\n` +
    `In a CI run the path comes from .github/actions/engine/pins.yml: ` +
    `\`instance_repo: <owner/repo>\` makes the workflow fetch that journal, and ` +
    `\`instance_repo: "."\` means the journal.yml sits in THIS repo, but there is no ` +
    `journal.yml at ${paperRoot}.\n` +
    `If this paper belongs to a journal, set instance_repo in pins.yml to that journal's ` +
    `owner/repo (\`oak bootstrap paper --instance\` writes it for you). Running locally, ` +
    `pass --instance <path to a checkout of the journal repo>.\n` +
    `Which journal to clone, and where to put it: ${docsUrl(DOCS.paperPreviewLocally)}`,

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
  composed: (root: string, instanceRoot: string | null): string =>
    `oak start: previewing ${root} with ${instanceRoot ? `the journal settings in ${instanceRoot}` : 'no journal settings (--no-instance): unbranded, engine defaults only'}.\n` +
    `This is the same config the paper's CI builds; myst reads myst.oak.yml, composed just now ` +
    `from your myst.yml. Edit myst.yml as usual; oak rewrites myst.oak.yml when you save it.\n` +
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

  recomposeFailed: (message: string): string =>
    `oak start: myst.yml changed but could not be composed, so the preview is still showing the ` +
    `previous version: ${message}`,
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
  idMaybeOwnEntry: (id: string, repo: string, slug: string): string =>
    `paper id "${id}" is registered to ${repo} (slug ${slug}); cannot confirm it is not this ` +
    `paper's own entry without a repo context`,
  idTaken: (id: string, repo: string, slug: string): string =>
    `paper id "${id}" already registered to ${repo} (slug ${slug})`,

  // ── thumbnail / typst template hygiene ─────────────────────────────────────────────────
  thumbnailUnresolved: (thumbnail: string): string =>
    `thumbnail "${thumbnail}" does not resolve to a file under the paper root; the ` +
    `paper will ship with NO thumbnail (a declared thumbnail disables myst's ` +
    `first-image fallback) and its gallery card renders blank`,
  templateOverride: (authorTemplate: string, journalTemplate: string): string =>
    `this paper declares its own typst template ("${authorTemplate}"), overriding the ` +
    `journal's ("${journalTemplate}"). Allowed and applied; flagged so a reviewer ` +
    `sees it.`,
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
    `myst.oak.yml could not be composed: ${failure}. The paper's own config caused it, so ` +
    `\`oak build\` fails the same way; the checks below ran on the paper's myst.yml alone, ` +
    `without oak's defaults, the edition or the branding.`,

  editorialLoadFailed: (message: string): string =>
    `could not load the paper project for editorial checks: ${message}`,
  needsBuildArtifacts: 'requires build artifacts; run `oak build` first',
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
  previewDeployed: (url: string): string =>
    [
      '**Preview deployed** 🚀',
      '',
      `${url}`,
      '',
      '_Updated on every push to this pull request._',
    ].join('\n'),

  previewArtifact: (runUrl: string, reason: string): string =>
    [
      '**Preview build ready** 📦',
      '',
      'No Cloudflare preview is configured, so the built site is attached to its Paper CI run as',
      `the **paper-build** artifact; open the run and scroll to **Artifacts**: ${runUrl}`,
      '',
      `_(${reason}.)_`,
    ].join('\n'),

  newVersionReminder: (doi: string, recordUrl: string): string =>
    [
      '**Zenodo new-version reminder**',
      '',
      'This paper is already published on Zenodo. Before tagging the next release, an editor must:',
      '',
      `1. Open the record: ${recordUrl}`,
      '2. Click **New version** to create an empty draft.',
      '',
      'Pushing the new `v*` tag fills that draft. The editor then clicks **Publish** on Zenodo.',
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
  unknownCheckId: (id: string): string =>
    `unknown check id "${id}"; the ids the journal can ask for, and how to change the set: ` +
    `${docsUrl(DOCS.checksChanging)}`,
  checkTableHeader: '| Check | Status | Detail |\n| --- | --- | --- |',

  /** A pull request that edits the files the checks run from. A warning, never a failure:
   *  upgrade pull requests edit them too. */
  shimWarning: (shown: string, more: string): string =>
    `> ⚠️ **This pull request changes the files that run the checks** (${shown}${more}). ` +
    `The results below come from its own copy of them, so they may not be the journal's ` +
    `checks. Unless this is an oak upgrade, an editor should read those changes before ` +
    `trusting the report.`,
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The workflow-run verbs (deposit / release / preview / notify / check-post / conformance).
 * Mostly read in a CI log, but every one of them can be typed by hand.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export const workflow = {
  // deposit
  depositUsage: 'oak deposit: usage: oak deposit <prepare|publish|status> [...]',
  badRepoName: (got: string): string =>
    `--repo takes owner/name, not ${JSON.stringify(got.slice(0, 60))}.`,

  previewBadJournal: (path: string, why: string): string =>
    `${path} could not be read (${why}), so the preview fell back to an artifact link. ` +
    `Fix the journal config and re-run; nothing else in this run depends on it.`,

  checkPostBadReport: (path: string): string =>
    `${path} is not a checks report (no checkRun.conclusion). It comes from the ` +
    `pull_request job's artifact, which is truncated, corrupt or hostile; nothing was posted.`,

  previewBadPrNumber: (got: string): string =>
    `.pr-number is not a pull request number (${JSON.stringify(got.slice(0, 40))}). It ` +
    `comes from the build artifact, which is corrupt or hostile.`,

  depositNoToken: (sandbox: boolean): string =>
    `no token: set ${sandbox ? 'ZENODO_TOKEN_SANDBOX' : 'ZENODO_TOKEN'} or pass --token`,
  depositNoRepo: 'deposit prepare: pass --repo owner/repo (or set GITHUB_REPOSITORY)',
  depositPublishArgs: 'deposit publish: --pdf and --tag are required',
  depositDoiPrOpened: (url: string): string => `deposit prepare: opened DOI PR ${url}`,
  depositDoiPrFailed: (message: string): string =>
    `deposit prepare: DOI PR not opened (${message})`,

  /** The DOI pull request `gh.openDoiPr` opens. GitHub holds the workflow runs of a pull
   *  request a bot opens, so the body says what the editor clicks. */
  doiPrTitle: 'Reserve Zenodo DOI',
  doiPrBody: (conceptDoi: string): string =>
    [
      `Writes the reserved concept DOI \`${conceptDoi}\` into \`myst.yml\`. Merge before tagging.`,
      '',
      '<details>',
      '<summary>Why are some checks waiting for approval?</summary>',
      '',
      'The Journal checks for this pull request are posted by the "Prepare Zenodo deposit" run ' +
        'that opened it. GitHub holds the workflow runs of a pull request a bot opens, so the ' +
        'Paper CI and Journal checks runs here wait for approval; neither is needed to merge. ' +
        'To run them anyway, approve them in the Actions tab, or close and reopen this pull ' +
        'request.',
      '',
      '</details>',
    ].join('\n'),

  // release
  releaseNoTag: 'oak release: --tag vX.Y.Z is required',
  releaseNoDoi: 'oak release: project.doi missing; run prepare and merge that pull request first.',
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
    'notify: a v* tag exists on main but project.doi is missing from myst.yml; the ' +
    'repo is published but unlinked. Fix myst.yml before tagging the next release.',
  notifyBadDoi: (doi: string): string =>
    `unrecognised DOI prefix: ${doi} (expected 10.5281/zenodo.* or 10.5072/zenodo.*)`,
  notifyFirstDeposit: 'no v* tags on main (first-deposit case)',
  notifyTagsFailed: (why: string): string =>
    `notify: gh could not list the repo's version tags (${why}); whether the paper is ` +
    'already published is unknown, and the reminder is not skipped on a guess.',

  // check-post
  checkPostArgs:
    'oak check-post: --report <path>, --repo <owner/repo>, --sha <headsha>, --base <branch> ' +
    'and --verified-head <headsha> are required',
  checkPostNoReport: (path: string): string => `oak check-post: report file not found: ${path}`,
  checkPostCheckRunFailed: (message: string): string =>
    `check-post: Check Run not posted (${message})`,
  checkPostCommentFailed: (message: string): string =>
    `check-post: comment not posted (${message})`,

  // validate's own failure report (what check-post posts when the run could not happen)
  validateCouldNotRun: 'oak validate could not run',
  validateCrashed: 'oak validate crashed',
  validateCrashLine: (details: string): string => `oak validate: ${details}`,

  // bootstrap / conformance argument errors
  bootstrapNoRepo: 'oak bootstrap: --repo <owner/name> is required',
  /** The engine repo has pre-releases but no stable one; "no release" would contradict its
   *  releases page. */
  bootstrapNoRelease:
    'oak bootstrap: the engine repo has no stable release to default to. Pass ' +
    '--engine-version <tag> to name one; a pre-release (a tag like v1.2.0-dev.4) has to be ' +
    'named, because it can be deleted, which breaks the papers pinned to it.',
  bootstrapUsage: 'oak bootstrap: usage: oak bootstrap <paper|journal> --repo <owner/name> [...]',
  bootstrapJournalTier: 'oak bootstrap journal: pass exactly one of --external | --co-located',
  bootstrapSecretsNeedPaper:
    'oak bootstrap journal --external: the secret flags (--zenodo-token, ' +
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
  /** As {@link workflow.bootstrapNoRelease}: a repo can have many pre-releases and still no
   *  stable release to move to. */
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
