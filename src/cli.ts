#!/usr/bin/env node
/**
 * The `oak` entry point, bundled to dist/cli.cjs at each release; CI calls it through ci/run.sh.
 * The myst side is imported only by the verbs that build, so other verbs start fast.
 */
import { join, resolve } from 'node:path';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdtempSync,
  watchFile,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import type { UpgradeMode } from './upgrade.js';
import type { ComposeInput } from './compose.js';
import type { MaterializeInput, StartOpts } from './materialize.js';
import * as msg from './messages.js';
import { annotate, UserError } from './messages.js';

// oak only runs as the CJS bundle [R51] (ci/run.sh and local runs both call dist/cli.cjs), so
// `__dirname` is the bundle's directory; @types/node declares it for tsc.
declare const __dirname: string;

type Verb =
  | 'build'
  | 'start'
  | 'validate'
  | 'check-post'
  | 'deploy-preview'
  | 'deposit'
  | 'release'
  | 'notify'
  | 'bootstrap'
  | 'upgrade'
  | 'conformance';

/** oak's root, the directory holding paper-base.yml: one up from the bundle, or two up from
 *  src/ in development. Found by probing. */
function engineRoot(): string {
  for (const up of ['..', '.']) {
    const cand = resolve(__dirname, up);
    if (existsSync(join(cand, 'paper-base.yml'))) return cand;
  }
  return resolve(__dirname, '..');
}

/**
 * The value after `--name`, or undefined when absent. A flag with no value (last, or followed by
 * another `--flag`) throws, since several callers read `flag(...) ?? process.env.X` and a
 * missing value must not fall through to the environment.
 *
 * An empty value is returned as it is [R147]: `??` keeps `''`, and some flags mean something by
 * it (`--base-url ""` serves at the root). Flags where empty is wrong check it themselves.
 */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UserError(msg.flagNeedsValue(name));
  return value;
}
function has(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** The `engine_repo` pin, for asset URLs. Repos carry pins.yml; the fallback is oak's own
 *  repo. */
function readEngineRepo(paperRoot: string): string {
  const pins = join(paperRoot, '.github', 'actions', 'engine', 'pins.yml');
  if (existsSync(pins)) {
    const v = parseDocument(readFileSync(pins, 'utf8')).get('engine_repo');
    if (typeof v === 'string') return v;
  }
  return 'Open-Scholar-Nexus/oaktree-sapling';
}

/**
 * Asset overrides from the checkout. `--typst-template` beats every other template; the
 * checkout's own `templates/typst` is the default, which a journal's or author's template
 * outranks [R76]. `--no-site-template` uses myst's default theme.
 *
 * Shared by `oak build` and `oak validate` so both write the same `myst.oak.yml` [R82], which
 * `readStampedTemplate` (zenodo.ts) reads as what was rendered.
 */
function assetOverridesFrom(argv: string[]): ComposeInput['assetOverrides'] {
  const localTypst = join(engineRoot(), 'templates', 'typst');
  const typstTemplate = flag(argv, 'typst-template');
  return {
    ...(typstTemplate ? { typstTemplate: resolve(typstTemplate) } : {}),
    ...(existsSync(localTypst) ? { engineTypstTemplate: localTypst } : {}),
    ...(has(argv, 'no-site-template') ? { siteTemplate: null as string | null } : {}),
  };
}

/**
 * Where the journal repo is [R38]: none with `--no-instance`, else `--instance`, else this repo
 * when a `journal.yml` sits beside the paper. The last case serves a repo that is its own
 * journal, where the engine action passes no `--instance` (`instance_repo: .`).
 *
 * Returns a root or an error string and never exits, so `oak validate` can report the error.
 */
function resolveInstanceRoot(
  argv: string[],
  paperRoot: string,
  verb: 'build' | 'start' | 'validate',
): { root: string | null } | { error: string } {
  if (has(argv, 'no-instance')) return { root: null };
  const explicit = flag(argv, 'instance');
  // Refused, since the error below would ask for the flag that was just passed [R147].
  if (explicit === '') throw new UserError(msg.flagNeedsValue('instance'));
  if (explicit) return { root: resolve(explicit) };
  if (existsSync(join(paperRoot, 'journal.yml'))) return { root: paperRoot };
  return { error: msg.build.noInstance(verb, paperRoot) };
}

/**
 * Whether this directory is a journal repo. Decided by the version key: a journal's
 * `myst.yml` is its website and has no `project.options.oaktree-sapling`, while a repo
 * that is both journal and paper has one. A `--no-site` journal has no myst.yml at all. An
 * unparseable myst.yml returns false and fails later with its own error.
 */
function isJournalRepo(root: string): boolean {
  if (!existsSync(join(root, 'journal.yml'))) return false;
  const mystPath = join(root, 'myst.yml');
  if (!existsSync(mystPath)) return true;
  try {
    const v = parseDocument(readFileSync(mystPath, 'utf8')).getIn([
      'project',
      'options',
      'oaktree-sapling',
      'version',
    ]);
    return !(typeof v === 'string' && v);
  } catch {
    return false;
  }
}

/** Everything `materializeDerived` needs but the myst side, shared by build and start so a
 *  preview composes from the same inputs as the build. */
function materializeInputFrom(
  argv: string[],
  paperRoot: string,
  instanceRoot: string | null,
): Omit<MaterializeInput, 'edge'> {
  return {
    paperRoot,
    engineRoot: engineRoot(),
    instanceRoot,
    engineRepo: flag(argv, 'engine-repo') ?? readEngineRepo(paperRoot),
    baseUrl: flag(argv, 'base-url') ?? '',
    assetOverrides: assetOverridesFrom(argv),
  };
}

/** Runs the two-pass build for a paper, for `oak build` and `oak release`. Returns the paper
 *  root, whose `_build/exports` then holds the PDF `release` deposits. */
async function buildPaper(argv: string[]): Promise<{ paperRoot: string; resolvedId?: string }> {
  const paperRoot = resolve(flag(argv, 'paper') ?? '.');
  if (isJournalRepo(paperRoot)) {
    process.stderr.write(annotate('error', msg.build.inJournalRepo(paperRoot)) + '\n');
    process.exit(2);
  }
  const resolved = resolveInstanceRoot(argv, paperRoot, 'build');
  if ('error' in resolved) {
    process.stderr.write(resolved.error + '\n');
    process.exit(2);
  }

  const { runBuild } = await import('./build.js');
  const { createMystEdge } = await import('./myst.js');
  const res = await runBuild({
    ...materializeInputFrom(argv, paperRoot, resolved.root),
    // --exports-only builds only the typst PDF, offline; --no-exports only the HTML.
    buildOpts: has(argv, 'exports-only')
      ? { exportsOnly: true }
      : has(argv, 'no-exports')
        ? { all: false, html: true }
        : { all: true, html: true },
    edge: createMystEdge(),
  });
  for (const w of res.warnings) process.stderr.write(annotate('warning', w) + '\n');
  return { paperRoot, resolvedId: res.resolvedProject.id };
}

/** `oak build`: builds a paper ({@link buildPaper}). Documented at DOCS.build. */
async function cmdBuild(argv: string[]): Promise<number> {
  const { resolvedId } = await buildPaper(argv);
  process.stderr.write(msg.build.done(resolvedId ?? '?') + '\n');
  return 0;
}

/** The `myst start` flags `oak start` passes through, under myst's names. */
function startOptsFrom(argv: string[]): StartOpts {
  const num = (name: string) => {
    const raw = flag(argv, name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new UserError(msg.flagNeedsPort(name, raw));
    return n;
  };
  const port = num('port');
  const serverPort = num('server-port');
  const template = flag(argv, 'template');
  const baseurl = flag(argv, 'base-url');
  return {
    ...(port !== undefined ? { port } : {}),
    ...(serverPort !== undefined ? { serverPort } : {}),
    ...(has(argv, 'headless') ? { headless: true } : {}),
    ...(has(argv, 'keep-host') ? { keepHost: true } : {}),
    ...(template ? { template } : {}),
    ...(baseurl ? { baseurl } : {}),
  };
}

/**
 * `oak start`: composes, then runs myst's dev server, the one `myst start` runs. Never returns:
 * `startServer` resolves once the server is up, and returning from `main()` would exit under
 * it. Ctrl-C ends it. Documented at DOCS.start.
 */
async function cmdStart(argv: string[]): Promise<number> {
  const paperRoot = resolve(flag(argv, 'paper') ?? '.');
  // Parsed before anything else, so a typo costs no build [R131].
  const startOpts = startOptsFrom(argv);
  const { createMystEdge } = await import('./myst.js');
  const edge = createMystEdge();

  // A journal repo's myst.yml is its website, a plain myst project: `oak build` refuses it
  // ({@link isJournalRepo}), but here myst serves it as it is, as the site workflow builds it.
  if (isJournalRepo(paperRoot)) {
    process.stderr.write(msg.start.journalSite(paperRoot) + '\n');
    await edge.start(paperRoot, startOpts);
    return await never();
  }

  const resolved = resolveInstanceRoot(argv, paperRoot, 'start');
  if ('error' in resolved) {
    process.stderr.write(resolved.error + '\n');
    return 2;
  }
  const input = { ...materializeInputFrom(argv, paperRoot, resolved.root), edge };

  const { runStart } = await import('./build.js');
  const { materializeDerived } = await import('./materialize.js');
  process.stderr.write(msg.start.composed(paperRoot, resolved.root) + '\n');
  const first = await runStart({ ...input, startOpts });
  for (const w of first.warnings) process.stderr.write(annotate('warning', w) + '\n');

  // myst watches the derived config, so an edit to the author's `myst.yml` would show nothing
  // until the next `oak start`. Recomposing on change rewrites `myst.oak.yml`, and myst's own
  // watcher reloads it.
  watchFile(join(paperRoot, 'myst.yml'), { interval: 500 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    materializeDerived(input).then(
      () => process.stderr.write(msg.start.recomposed + '\n'),
      // A half-edited config is normal while typing: say what is stale and keep serving.
      (e) =>
        process.stderr.write(msg.start.recomposeFailed(String((e as Error)?.message ?? e)) + '\n'),
    );
  });
  return await never();
}

/** Keeps the process alive for the running server: never resolves, so `main()` never exits. */
function never(): Promise<number> {
  return new Promise<number>(() => {});
}

/** myst.yml path from --myst, or <--paper|.>/myst.yml. */
function mystPathOf(argv: string[]): string {
  return resolve(flag(argv, 'myst') ?? join(flag(argv, 'paper') ?? '.', 'myst.yml'));
}
function instanceRootOf(argv: string[]): string | null {
  const i = flag(argv, 'instance');
  return i ? resolve(i) : null;
}

/** Keys the human summary leaves out: narrated already (`runbook`, printed line by line with
 *  `→`), or a markdown document for the pull request (`checkRun`). */
const SUMMARY_SKIP = new Set(['runbook', 'checkRun']);

/** A result object for a human, one `key: value` line per field: string arrays as bullets,
 *  nested objects as `k=v`, empty values left out. */
function summarize(result: Record<string, unknown>): string[] {
  // A refusal prints its message, which names the verb and the fix.
  if (result.status === 'error') {
    const text = result.error ?? result.message;
    if (typeof text === 'string') return [text];
  }
  // An abort was explained at the prompt.
  if (result.status === 'aborted') return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (SUMMARY_SKIP.has(key) || value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      if (value.every((v) => typeof v === 'string')) {
        lines.push(`${key}:`);
        for (const v of value) lines.push(`  - ${v}`);
      } else lines.push(`${key}: ${value.length}`);
    } else if (typeof value === 'object') {
      const inner = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      if (inner) lines.push(`${key}: ${inner}`);
    } else lines.push(`${key}: ${value}`);
  }
  return lines;
}

/**
 * The human output for verbs that narrate each step as it happens (`bootstrap`, `upgrade`): the
 * result recaps lines already on screen, so it ends with one line naming what to open.
 */
function narrated(result: Record<string, unknown>): string[] {
  const special = summarize(result);
  if (result.status !== 'ok') return special;
  const what = result.repo ?? result.target ?? '';
  const links = [result.pr, result.site_url].filter(
    (v): v is string => typeof v === 'string' && !!v,
  );
  return [`done: ${what}${links.length ? `; ${links.join('  ')}` : ''}`];
}

/**
 * Prints a verb's result. The JSON is opt-in (`--json`), since otherwise it repeats the prose the
 * verb already printed. Human output goes to stderr, so with `--json` stdout carries only the
 * JSON. CI reads files, not stdout (`oak validate --report`, `oak conformance --record`).
 */
function emit(
  argv: string[],
  result: Record<string, unknown>,
  human?: (r: Record<string, unknown>) => string[],
): void {
  if (has(argv, 'json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  for (const line of (human ?? summarize)(result)) process.stderr.write(line + '\n');
}

/** `oak deposit <prepare|publish|status>`, the Zenodo verbs. Documented at DOCS.deposit. */
async function cmdDeposit(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  const z = await import('./zenodo.js');
  const gh = await import('./gh.js');

  const mystPath = mystPathOf(rest);
  const instanceRoot = instanceRootOf(rest);
  const sandbox = has(rest, 'sandbox');
  const siteUrl = flag(rest, 'site-url') ?? process.env.SITE_URL;
  // The environment picks the token, as in `oak release` [R102]; a sandbox run never uses the
  // production one [R133].
  const token =
    flag(rest, 'token') ?? (sandbox ? process.env.ZENODO_TOKEN_SANDBOX : process.env.ZENODO_TOKEN);
  if (!token) {
    process.stderr.write(msg.workflow.depositNoToken(sandbox) + '\n');
    return 2;
  }
  const api = new z.ZenodoApi(z.createFetchTransport(), sandbox, token);

  if (sub === 'prepare') {
    const repo = flag(rest, 'repo') ?? process.env.GITHUB_REPOSITORY;
    if (!repo) {
      process.stderr.write(msg.workflow.depositNoRepo + '\n');
      return 2;
    }
    const out = await z.cmdPrepare({ mystPath, repo, siteUrl, api, instanceRoot });
    emit(rest, out.result);
    // Open the DOI pull request for the myst.yml write [R3]. Without gh or a token (a local
    // sandbox run) the write is left for a person to commit.
    if (out.exitCode === 0 && !has(rest, 'no-pr') && process.env.GH_TOKEN) {
      try {
        const url = gh.openDoiPr(resolve(mystPath, '..'), {
          conceptDoi: String(out.result.concept_doi),
        });
        process.stderr.write(msg.workflow.depositDoiPrOpened(url) + '\n');
      } catch (e) {
        process.stderr.write(
          annotate('warning', msg.workflow.depositDoiPrFailed((e as Error).message)) + '\n',
        );
      }
    }
    return out.exitCode;
  }

  if (sub === 'publish') {
    const pdf = flag(rest, 'pdf');
    const tag = flag(rest, 'tag');
    if (!pdf || !tag) {
      process.stderr.write(msg.workflow.depositPublishArgs + '\n');
      return 2;
    }
    const out = await z.cmdPublish({
      mystPath,
      pdf: resolve(pdf),
      tag,
      siteUrl,
      bundleOut: resolve(flag(rest, 'bundle-out') ?? '_bundle'),
      api,
      git: gh.realGitContext,
      instanceRoot,
      engineRoot: engineRoot(),
    });
    emit(rest, out.result);
    return out.exitCode;
  }

  if (sub === 'status') {
    const out = await z.cmdStatus({ mystPath, siteUrl, api, instanceRoot });
    emit(rest, out.result);
    return out.exitCode;
  }

  process.stderr.write(msg.workflow.depositUsage + '\n');
  return 2;
}

function findExportedPdf(paperRoot: string): string | null {
  const dir = join(paperRoot, '_build', 'exports');
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir, { recursive: true }).find((f) => String(f).endsWith('.pdf'));
  return hit ? join(dir, String(hit)) : null;
}

/** `oak release --tag vX [--no-build]`: builds, publishes the deposit, attaches the bundle to the
 *  tag's release, and comments on the commit or opens a failure issue. The environment follows
 *  the committed DOI. Documented at DOCS.release. */
async function cmdRelease(argv: string[]): Promise<number> {
  const tag = flag(argv, 'tag');
  if (!tag) {
    process.stderr.write(msg.workflow.releaseNoTag + '\n');
    return 2;
  }
  const z = await import('./zenodo.js');
  const gh = await import('./gh.js');

  // Build in a child process: myst's HTML build calls process.exit(0) on success, which would end
  // `release` before the deposit. The parent then reads the PDF (_build/exports) and abstract
  // (_build/site/content) from the same tree; `oak build` ignores release's extra flags.
  // `--no-build` deposits a build made elsewhere: CI builds in a job holding no token.
  const paperRoot = resolve(flag(argv, 'paper') ?? '.');
  if (!has(argv, 'no-build'))
    execFileSync(process.execPath, [process.argv[1]!, 'build', ...argv], { stdio: 'inherit' });
  const mystPath = mystPathOf(argv);

  const doi = parseDocument(readFileSync(mystPath, 'utf8')).getIn(['project', 'doi']);
  if (typeof doi !== 'string' || !doi) {
    process.stderr.write(msg.workflow.releaseNoDoi + '\n');
    return 2;
  }
  const sandbox = z.isSandboxDoi(doi);
  const token =
    flag(argv, 'token') ?? (sandbox ? process.env.ZENODO_TOKEN_SANDBOX : process.env.ZENODO_TOKEN);
  if (!token) {
    process.stderr.write(msg.workflow.releaseNoToken(sandbox) + '\n');
    return 2;
  }

  const pdf = findExportedPdf(paperRoot);
  if (!pdf) {
    process.stderr.write(msg.workflow.releaseNoPdf + '\n');
    return 2;
  }

  const api = new z.ZenodoApi(z.createFetchTransport(), sandbox, token);
  const bundleOut = resolve(flag(argv, 'bundle-out') ?? '_bundle');
  const out = await z.cmdPublish({
    mystPath,
    pdf,
    tag,
    siteUrl: flag(argv, 'site-url') ?? process.env.SITE_URL,
    bundleOut,
    api,
    git: gh.realGitContext,
    instanceRoot: instanceRootOf(argv),
    engineRoot: engineRoot(),
  });
  emit(argv, out.result);

  if (out.exitCode === 0 && process.env.GH_TOKEN) {
    try {
      const files = readdirSync(bundleOut).map((f) => join(bundleOut, f));
      gh.uploadReleaseAsset(paperRoot, tag, files);
      const sha = await gh.realGitContext.headSha(paperRoot);
      gh.postCommitComment(
        paperRoot,
        sha,
        msg.workflow.releaseCommitComment(String(out.result.draft_url ?? out.result.version_doi)),
      );
    } catch (e) {
      process.stderr.write(
        annotate('warning', msg.workflow.releasePostStepsFailed((e as Error).message)) + '\n',
      );
    }
  } else if (out.exitCode !== 0 && process.env.GH_TOKEN) {
    try {
      gh.openFailureIssue(
        paperRoot,
        msg.workflow.releaseFailureIssue(tag),
        String(out.result.message ?? 'unknown error'),
      );
    } catch {
      /* best-effort */
    }
  }
  return out.exitCode;
}

/** `oak deploy-preview <site>`: deploys the build artifact to Cloudflare Pages, or falls back to a
 *  link to it [R16], posts the preview comment, then runs the new-version reminder. */
async function cmdDeployPreview(argv: string[]): Promise<number> {
  const preview = await import('./preview.js');
  const gh = await import('./gh.js');
  const siteDir = resolve(argv.find((a) => !a.startsWith('--')) ?? 'site');
  const out = await preview.cmdDeployPreview(
    {
      siteDir,
      repoRoot: resolve(flag(argv, 'paper') ?? '.'),
      instanceRoot: instanceRootOf(argv),
      repo: flag(argv, 'repo') ?? process.env.GITHUB_REPOSITORY ?? null,
      serverUrl: process.env.GITHUB_SERVER_URL ?? 'https://github.com',
      artifactRunId: process.env.PAPER_BUILD_RUN_ID,
      cf: {
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      },
      mystPath: mystPathOf(argv),
    },
    { deployer: gh.realPagesDeployer, gh: gh.realGhPr },
  );
  emit(argv, out.result);
  return out.exitCode;
}

/** `oak notify new-version [--pr N | --site <dir>]`: the new-version reminder on its own.
 *  deploy-preview runs the same logic [R16]; here `.pr-number` is only read, since deleting it is
 *  deploy-preview's [R26]. Documented at DOCS.notify. */
async function cmdNotify(argv: string[]): Promise<number> {
  if (argv[0] !== 'new-version') {
    process.stderr.write(msg.workflow.notifyUsage + '\n');
    return 2;
  }
  const rest = argv.slice(1);
  const preview = await import('./preview.js');
  const gh = await import('./gh.js');

  let pr = flag(rest, 'pr');
  if (!pr) {
    const f = join(resolve(flag(rest, 'site') ?? 'site'), '.pr-number');
    if (existsSync(f)) pr = readFileSync(f, 'utf8').trim();
  }
  if (pr) preview.assertPrNumber(pr);
  if (!pr) {
    process.stderr.write(msg.workflow.notifyNoPr + '\n');
    return 2;
  }

  const out = preview.runNewVersionReminder(
    {
      repoRoot: resolve(flag(rest, 'paper') ?? '.'),
      mystPath: mystPathOf(rest),
      repo: flag(rest, 'repo') ?? process.env.GITHUB_REPOSITORY ?? null,
      pr,
    },
    gh.realGhPr,
  );
  emit(rest, out.result);
  return out.exitCode;
}

/** The paper's edition, or null. Never throws: `oak validate` reports a missing or malformed
 *  version key as a finding. */
function readEditionQuietly(paperRoot: string): string | null {
  try {
    const v = parseDocument(readFileSync(join(paperRoot, 'myst.yml'), 'utf8')).getIn([
      'project',
      'options',
      'oaktree-sapling',
      'edition',
    ]);
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/**
 * Writes a failing `--report` for a run that could not produce one. The `pull_request` job only
 * checks `jq -e '.checkRun.conclusion'`, so a missing file would tell the author "engine crash"
 * and nothing more. Even a usage error or an unexpected throw leaves a readable failing report
 * for check-post to post [R82]. If this write fails too, the missing-report path still applies.
 */
function writeFailureReport(reportPath: string | undefined, title: string, message: string): void {
  if (!reportPath) return;
  try {
    writeFileSync(
      resolve(reportPath),
      JSON.stringify(
        {
          status: 'error',
          errors: [message],
          warnings: [],
          checks: [],
          notes: [],
          checkRun: {
            conclusion: 'failure',
            title,
            summary: `**${title}**\n\n${'```'}\n${message}\n${'```'}`,
            annotations: [],
          },
        },
        null,
        2,
      ),
    );
  } catch {
    /* the `pull_request` job's own check still catches a missing report */
  }
}

/**
 * The human output of a validate run: the result and every finding. The JSON exists for
 * check-post, which reads `--report <path>`. Leaving out findings would change the result.
 */
function validateSummary(out: {
  status: string;
  errors: Array<{ check: string; message: string }>;
  warnings: Array<{ check: string; message: string }>;
  checks: Array<{ id: string; status: string; message?: string; optional?: boolean }>;
  notes: string[];
}): string[] {
  const passed = out.checks.filter((c) => String(c.status) === 'pass').length;
  const counts = [
    out.errors.length ? msg.validate.countErrors(out.errors.length) : '',
    out.warnings.length ? msg.validate.countWarnings(out.warnings.length) : '',
    out.checks.length ? msg.validate.countChecks(passed, out.checks.length) : '',
  ].filter(Boolean);
  const lines = [msg.validate.verdict(out.status === 'ok', counts)];
  for (const e of out.errors) lines.push(`  ✗ ${e.check}: ${e.message}`);
  for (const w of out.warnings) lines.push(`  ! ${w.check}: ${w.message}`);
  for (const c of out.checks) {
    if (String(c.status) === 'pass') continue;
    lines.push(`  ${c.optional ? '!' : '✗'} ${c.id}: ${c.message ?? String(c.status)}`);
  }
  for (const n of out.notes) lines.push(`  → ${n}`);
  return lines;
}

/** `oak validate`: oak's own rules (Layer A) and the journal's editorial checks (Layer B), with
 *  `--report <path>` writing the JSON check-post posts. Documented at DOCS.validate. */
async function cmdValidate(argv: string[]): Promise<number> {
  const paperRoot = resolve(flag(argv, 'paper') ?? '.');
  const reportPath = flag(argv, 'report');
  // A journal repo has no version key, so validate stops with a sentence ({@link isJournalRepo},
  // as in `oak build`).
  if (isJournalRepo(paperRoot)) {
    const text = msg.validate.inJournalRepo(paperRoot);
    process.stderr.write(annotate('error', text) + '\n');
    writeFailureReport(reportPath, msg.workflow.validateCouldNotRun, text);
    return 2;
  }
  const resolved = resolveInstanceRoot(argv, paperRoot, 'validate');
  if ('error' in resolved) {
    process.stderr.write(annotate('error', resolved.error) + '\n');
    writeFailureReport(reportPath, msg.workflow.validateCouldNotRun, resolved.error);
    return 2;
  }
  const instanceRoot = resolved.root;
  const strict = has(argv, 'strict');

  const gh = await import('./gh.js');
  const repo = flag(argv, 'repo') ?? process.env.GITHUB_REPOSITORY ?? gh.originRepo(paperRoot);

  const { runValidate } = await import('./validate.js');
  const { createMystEdge } = await import('./myst.js');

  // myst-cli writes progress to stdout, through its logger and a raw `console.debug` in `new
  // Session()`, which would corrupt the JSON `emit()` writes there. Forward stdout to stderr
  // during the run, keeping myst's formatting, and restore it before emitting.
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  let out;
  try {
    out = await runValidate(
      {
        // The inputs `oak build` composes from, spread from the same builder so a field added for
        // build reaches validate too [R82]. The [R72] check also needs oak's checkout and the
        // edition; without both, validate reads the author's config and says so.
        ...materializeInputFrom(argv, paperRoot, instanceRoot),
        edge: createMystEdge(),
        edition: readEditionQuietly(paperRoot),
      },
      { strict, repo, pathBase: process.env.GITHUB_WORKSPACE ?? paperRoot },
    );
  } catch (err) {
    // runValidate catches the faults it can name, so anything here is oak's own, and it still
    // writes a readable report; the `pull_request` job alone would say only "engine crash".
    process.stdout.write = realStdoutWrite;
    // A UserError is a paper to fix: report its sentence only, since a stack in a Check Run
    // summary gives an author nothing to act on.
    const userFault = err instanceof UserError;
    const message = userFault ? (err as Error).message : String((err as Error)?.stack ?? err);
    process.stderr.write(
      annotate('error', userFault ? message : msg.workflow.validateCrashLine(message)) + '\n',
    );
    writeFailureReport(
      reportPath,
      userFault ? msg.workflow.validateCouldNotRun : msg.workflow.validateCrashed,
      message,
    );
    return userFault ? 2 : 1;
  } finally {
    process.stdout.write = realStdoutWrite;
  }

  emit(
    argv,
    {
      status: out.status,
      errors: out.errors,
      warnings: out.warnings,
      checks: out.checks,
      // Only an uncomposed run says so [R82]: the report is the one place a reader learns the
      // findings came from the author's config.
      ...(out.notes.length ? { notes: out.notes } : {}),
      checkRun: out.checkRun,
    },
    () => validateSummary(out),
  );

  // `--report <path>`: the full JSON, `checkRun` included, for check-post, which posts the Check
  // Run and the sticky comment from the trusted `workflow_run` job.
  if (reportPath) {
    writeFileSync(
      resolve(reportPath),
      JSON.stringify(
        {
          status: out.status,
          errors: out.errors,
          warnings: out.warnings,
          checks: out.checks,
          notes: out.notes,
          checkRun: out.checkRun,
        },
        null,
        2,
      ),
    );
  }
  return out.exitCode;
}

/** `oak check-post --report <path> --repo <o/r> --sha <headsha> [--pr <n>]`: posts the report
 *  from the trusted `workflow_run` job (checks and pull-requests write). Never reruns validate or
 *  touches myst. Failing to post the Check Run fails the job; a failed comment only warns. Needs
 *  GH_TOKEN. Documented at DOCS.checkPost. */
async function cmdCheckPost(argv: string[]): Promise<number> {
  const reportPath = flag(argv, 'report');
  const repo = flag(argv, 'repo') ?? process.env.GITHUB_REPOSITORY;
  const sha = flag(argv, 'sha');
  const pr = flag(argv, 'pr');
  // The gated-files warning [R83]: --base and --verified-head come from the workflow_run event,
  // which GitHub sets and the fork's artifact cannot, so a pull request editing `.github/` or
  // `CODEOWNERS` is flagged even if the artifact lies.
  const base = flag(argv, 'base');
  const verifiedHead = flag(argv, 'verified-head');
  if (!reportPath || !repo || !sha || !base || !verifiedHead) {
    process.stderr.write(msg.workflow.checkPostArgs + '\n');
    return 2;
  }
  if (!existsSync(reportPath)) {
    process.stderr.write(msg.workflow.checkPostNoReport(reportPath) + '\n');
    return 2;
  }
  // The report comes from the fork's code, and so does the `pull_request` job's jq check of it
  // [R137], so it is untrusted input. A bad one gets a sentence, not a stack.
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    process.stderr.write(annotate('error', msg.workflow.checkPostBadReport(reportPath)) + '\n');
    return 1;
  }
  const cr = report?.checkRun;
  if (!cr || typeof cr.conclusion !== 'string') {
    process.stderr.write(annotate('error', msg.workflow.checkPostBadReport(reportPath)) + '\n');
    return 1;
  }

  const gh = await import('./gh.js');
  const { cmdCheckPost: run, frozenPathsTouched } = await import('./checks.js');
  const shimTouched = frozenPathsTouched(gh.changedFiles(repo, base, verifiedHead));
  const out = run(
    { report, repo, sha, pr, shimTouched },
    {
      checkRun: gh.realCheckRun,
      sticky: (root, prNum, header, body) => gh.realGhPr.sticky(root, prNum, header, body),
    },
  );
  emit(argv, { ...out });
  return out.checkRunPosted ? 0 : 1;
}

/** oak's own repo, matching readEngineRepo's fallback. */
const ENGINE_REPO_DEFAULT = 'Open-Scholar-Nexus/oaktree-sapling';

/** Prints the plan to stderr, then takes --yes (required without a TTY) or asks. */
function makeConfirm(argv: string[]): (plan: string[]) => Promise<boolean> {
  return async (plan) => {
    for (const line of plan) process.stderr.write(line + '\n');
    if (has(argv, 'yes')) return true;
    if (!process.stdin.isTTY) {
      process.stderr.write(msg.prompt.nonTty + '\n');
      return false;
    }
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const ans = (await rl.question(msg.prompt.proceed)).trim();
    rl.close();
    if (/^y/i.test(ans)) return true;
    // Every abort says why: a bare `{"status":"aborted"}` after a prompt that defaults to No
    // reads as oak refusing.
    process.stderr.write(msg.prompt.declined(ans) + '\n');
    return false;
  };
}

function workdir(prefix: string): () => string {
  return () => mkdtempSync(join(tmpdir(), prefix));
}

function secretsFrom(argv: string[]) {
  return {
    zenodoToken: flag(argv, 'zenodo-token') ?? process.env.ZENODO_TOKEN,
    zenodoTokenSandbox: flag(argv, 'zenodo-token-sandbox') ?? process.env.ZENODO_TOKEN_SANDBOX,
    cfToken: flag(argv, 'cf-token') ?? process.env.CLOUDFLARE_API_TOKEN,
    cfAccount: flag(argv, 'cf-account') ?? process.env.CLOUDFLARE_ACCOUNT_ID,
  };
}

/** The secret flags, to tell a typed one from an environment value in a refusal. */
const SECRET_FLAGS = ['zenodo-token', 'zenodo-token-sandbox', 'cf-token', 'cf-account'] as const;

/** `oak bootstrap <paper|journal>`. Documented at DOCS.bootstrap. */
async function cmdBootstrap(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  const gh = await import('./gh.js');
  const bootstrap = await import('./bootstrap.js');
  const paperTemplateRoot = bootstrap.paperTemplateRoot(engineRoot());
  const instanceTemplateRoot = bootstrap.instanceTemplateRoot(engineRoot());
  const siteTemplateRoot = bootstrap.siteTemplateRoot(engineRoot());
  const mystRange = bootstrap.engineMystRange(engineRoot());

  const repo = flag(rest, 'repo');
  if (!repo) {
    process.stderr.write(msg.workflow.bootstrapNoRepo + '\n');
    return 2;
  }
  // Malformed arguments are refused before any gh call [R127].
  const external = sub === 'journal' && has(rest, 'external');
  if (sub === 'journal') {
    if (external === has(rest, 'co-located')) {
      process.stderr.write(msg.workflow.bootstrapJournalTier + '\n');
      return 2;
    }
    // A typed secret flag is refused with an external journal; environment values are allowed
    // [R127].
    if (external && SECRET_FLAGS.some((f) => flag(rest, f))) {
      process.stderr.write(msg.workflow.bootstrapSecretsNeedPaper + '\n');
      return 2;
    }
  }
  gh.assertGhReady();
  const engineRepo = flag(rest, 'engine-repo') ?? ENGINE_REPO_DEFAULT;
  let engineVersion = flag(rest, 'engine-version');
  // The plan says how the version was chosen: "the newest release now" and "the tag you named"
  // differ, and only the second is reproducible.
  const engineVersionFrom: 'flag' | 'latest-release' = engineVersion ? 'flag' : 'latest-release';
  if (!engineVersion) {
    try {
      engineVersion = gh.latestEngineRelease(engineRepo);
    } catch {
      process.stderr.write(msg.workflow.bootstrapNoRelease + '\n');
      return 2;
    }
  }
  const resolved = {
    engineVersionFrom,
    engineRepoFrom: (flag(rest, 'engine-repo') ? 'flag' : 'default') as 'flag' | 'default',
  };
  const deps = {
    prov: gh.realProvisioner,
    paperTemplateRoot,
    instanceTemplateRoot,
    siteTemplateRoot,
    mystRange,
    log: (m: string) => process.stderr.write(m + '\n'),
    confirm: makeConfirm(rest),
    workdir: workdir('oak-bootstrap-'),
  };

  if (sub === 'paper') {
    const out = await bootstrap.cmdBootstrapPaper(
      {
        repo,
        from: flag(rest, 'from'),
        sourceRef: flag(rest, 'source-ref'),
        instance: flag(rest, 'instance'),
        // No default: the paper joins a journal that already has editions, and an invented
        // `edition` would match none of them, so the paper's CI would fail later on a missing
        // edition file.
        edition: flag(rest, 'edition'),
        engineVersion,
        engineRepo,
        owner: flag(rest, 'owner'),
        authedUser: gh.authedUser(),
        private: has(rest, 'private'),
        requireChecks: !has(rest, 'no-require-checks'),
        secrets: secretsFrom(rest),
        resolved,
      },
      deps,
    );
    emit(rest, out.result, narrated);
    return out.exitCode;
  }

  if (sub === 'journal') {
    const out = await bootstrap.cmdBootstrapJournal(
      {
        repo,
        tier: external ? 'external' : 'co-located',
        name: flag(rest, 'name'),
        // Defaulted, and shown in the plan: the new journal's edition file is named from this
        // value, so the two agree. The journal can rename it.
        edition: flag(rest, 'edition'),
        engineVersion,
        engineRepo,
        owner: flag(rest, 'owner'),
        authedUser: gh.authedUser(),
        requireChecks: !has(rest, 'no-require-checks'),
        site: !has(rest, 'no-site'),
        secrets: secretsFrom(rest),
        resolved,
      },
      deps,
    );
    emit(rest, out.result, narrated);
    return out.exitCode;
  }

  process.stderr.write(msg.workflow.bootstrapUsage + '\n');
  return 2;
}

/** `oak upgrade`. Documented at DOCS.upgrade. */
async function cmdUpgrade(argv: string[]): Promise<number> {
  const gh = await import('./gh.js');
  const upgrade = await import('./upgrade.js');

  const paper = flag(argv, 'paper');
  const repo = flag(argv, 'repo');
  if (!paper && !repo) {
    process.stderr.write(msg.upgrade.missingTarget + '\n');
    return 2;
  }
  const mode: UpgradeMode = has(argv, 'version-only')
    ? 'version-only'
    : has(argv, 'files-only')
      ? 'files-only'
      : 'both';
  const repoRoot = paper ? resolve(paper) : gh.tempClone(gh.assertRepoName(repo!));

  const out = await upgrade.cmdUpgrade(
    { repoRoot, to: flag(argv, 'to'), mode },
    {
      resolveTarget: gh.latestEngineRelease,
      materializeTemplate: gh.materializeTemplate,
      pr: gh.realUpgradePr,
      log: (m) => process.stderr.write(m + '\n'),
      confirm: makeConfirm(argv),
    },
  );
  emit(argv, out.result, narrated);
  return out.exitCode;
}

/** `oak conformance <reset|run>`: tests a release on GitHub; `reset` removes what earlier
 *  runs left and is idempotent. Documented at DOCS.conformance. */
async function cmdConformance(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  const gh = await import('./gh.js');
  const conformance = await import('./conformance.js');
  const deps = { gh: gh.realConformanceGh, log: (m: string) => process.stderr.write(m + '\n') };

  if (sub === 'reset') {
    const repo = flag(rest, 'repo');
    if (!repo) {
      process.stderr.write(msg.workflow.conformanceResetArgs + '\n');
      return 2;
    }
    const out = await conformance.cmdConformanceReset({ repo }, deps);
    emit(rest, out.result);
    return out.exitCode;
  }

  if (sub === 'run') {
    const repo = flag(rest, 'repo');
    const tag = flag(rest, 'tag');
    if (!repo || !tag) {
      process.stderr.write(msg.workflow.conformanceRunArgs + '\n');
      return 2;
    }
    const upgrade = await import('./upgrade.js');
    // The fork preview runs only when the fork repo and its token are both set.
    const forkRepo = flag(rest, 'fork-repo') ?? process.env.CONFORMANCE_FORK_REPO;
    const forkToken = process.env.CONFORMANCE_FORK_PAT;
    const out = await conformance.cmdConformanceRun(
      { repo, tag, runId: flag(rest, 'run-id') },
      {
        ...deps,
        fork: forkRepo && forkToken ? { repo: forkRepo, token: forkToken } : null,
        sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
        probe: async (url) => {
          try {
            return (await fetch(url)).status;
          } catch {
            return 0;
          }
        },
        // Installs the release on the test repo as a journal would: `oak upgrade --both` on a
        // fresh clone, in-process.
        installEngine: async (r, t) => {
          const up = await upgrade.cmdUpgrade(
            { repoRoot: gh.tempClone(r), to: t, mode: 'both' },
            {
              resolveTarget: gh.latestEngineRelease,
              materializeTemplate: gh.materializeTemplate,
              pr: gh.realUpgradePr,
              log: deps.log,
              confirm: async () => true,
            },
          );
          const prUrl = (up.result.pr as string | null) ?? null;
          return {
            upToDate: Boolean(up.result.up_to_date),
            prUrl,
            prNumber: prUrl ? Number(prUrl.split('/').pop()) : null,
          };
        },
      },
    );
    emit(rest, out.result);
    // `--record` writes the result to a file, which the workflow uploads to the release. The file
    // is what machines read; stdout carries JSON only with `--json`.
    const record = flag(rest, 'record');
    if (record) writeFileSync(resolve(record), JSON.stringify(out.result, null, 2) + '\n');
    return out.exitCode;
  }

  process.stderr.write(msg.workflow.conformanceUsage + '\n');
  return 2;
}

const VERBS: Verb[] = [
  'build',
  'start',
  'validate',
  'check-post',
  'deploy-preview',
  'deposit',
  'release',
  'notify',
  'bootstrap',
  'upgrade',
  'conformance',
];

/** Levenshtein distance: only ever run over two short command words. */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** The closest command to a typo, or null when nothing is close enough to suggest. */
function nearestVerb(word: string): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const v of VERBS) {
    const d = editDistance(word.toLowerCase(), v);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return bestD <= 3 ? best : null;
}

/** Set by the bundle: the release tag's version, or package.json's in a local build. */
declare const OAK_VERSION: string;

async function main(argv: string[]): Promise<number> {
  const verb = argv[0] as Verb | undefined;
  // One environment variable, read by gh.ts, so `--verbose` reaches the git and gh calls
  // without passing a parameter around, and survives the child process `oak release` starts.
  if (has(argv, 'verbose')) process.env.OAK_VERBOSE = '1';
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(msg.usage());
    return 0;
  }
  if (argv[0] === '--version') {
    process.stdout.write(msg.version(OAK_VERSION) + '\n');
    return 0;
  }
  if (verb === 'build') return cmdBuild(argv.slice(1));
  if (verb === 'start') return cmdStart(argv.slice(1));
  if (verb === 'validate') return cmdValidate(argv.slice(1));
  if (verb === 'check-post') return cmdCheckPost(argv.slice(1));
  if (verb === 'deposit') return cmdDeposit(argv.slice(1));
  if (verb === 'release') return cmdRelease(argv.slice(1));
  if (verb === 'deploy-preview') return cmdDeployPreview(argv.slice(1));
  if (verb === 'notify') return cmdNotify(argv.slice(1));
  if (verb === 'bootstrap') return cmdBootstrap(argv.slice(1));
  if (verb === 'upgrade') return cmdUpgrade(argv.slice(1));
  if (verb === 'conformance') return cmdConformance(argv.slice(1));
  // An unknown command is an error with a suggestion: printing usage alone would make a typo
  // look like a bare `oak`, as if the command ran and did nothing.
  if (verb) {
    const near = nearestVerb(verb);
    process.stderr.write(msg.unknownCommand(verb, near) + '\n');
  }
  process.stderr.write(msg.usage());
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    // A UserError is written for whoever typed the command: one sentence naming the file and the
    // fix, exit 2, no stack. Anything else is a bug in oak, and the stack is what helps.
    if (err instanceof UserError) {
      process.stderr.write(annotate('error', err.message) + '\n');
      process.exit(2);
    }
    process.stderr.write(annotate('error', msg.engineCrash(String(err?.stack ?? err))) + '\n');
    process.exit(1);
  },
);
