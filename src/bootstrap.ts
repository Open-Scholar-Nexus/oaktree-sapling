/**
 * `oak bootstrap paper` and `oak bootstrap journal`: sets up a paper repo (new, or from an
 * author's repo with `--from`) or a journal repo from the templates. Every step reads
 * the current state first, so a rerun repairs a partial bootstrap. Content only arrives through a
 * pull request, and a missing secret is listed in the closing runbook rather than set [R25].
 */
import * as msg from './messages.js';
import { firstLine } from './messages.js';
import {
  readdirSync,
  statSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { isMap, isScalar } from 'yaml';
import { readDoc } from './yaml-io.js';
import { themeZipUrl } from './assets.js';
import { LABEL_EDITOR_ACTION, LABEL_ZENODO_FAILED } from './preview.js';

/* --------------------------------------------------------------------------
 * Settings and template rendering (pure)
 * ------------------------------------------------------------------------ */

export interface TemplateAnswers {
  /** The repo oak is checked out from (pins.yml `engine_repo`). */
  engineRepo: string;
  /** The journal repo, or '.' when this repo is the journal (pins.yml
   *  `instance_repo`). */
  instanceRepo: string;
  /** The CODEOWNERS owner: `@user` or `@org/team`. */
  owner: string;
  /** The oak release written into the starter myst.yml. */
  version: string;
  /** The edition, written into the starter myst.yml and used to name the edition file. */
  edition: string;
  /** The journal's name, for `journal.yml`, the brand's `logo_text` and the edition's `venue`. */
  journalName?: string;
  /** The repo being bootstrapped (`owner/name`), written as the starter paper's
   *  `project.github`. */
  repo?: string;
  /** The journal website's URL, for the brand's `logo_url`, so each paper's header links back
   *  to it. Unset when there is no website. */
  siteUrl?: string;
}

/** The journal name the templates ship, replaced by `--name`. */
const JOURNAL_NAME_PLACEHOLDER = 'CHANGE-ME Journal';

const RENDER_PINS = posix.join('.github', 'actions', 'engine', 'pins.yml');
const RENDER_CODEOWNERS = 'CODEOWNERS';
const RENDER_MYST = 'myst.yml';
const RENDER_SITE_INDEX = posix.join('pages', 'index.md');
const RENDER_SITE_PKG = 'package.json';
/** Template files that document the template and are never copied: each template's README. The
 *  `template disjointness invariant` tests (test/template.test.ts) check the templates write
 *  disjoint paths. */
const EXCLUDE_FROM_STAMP = new Set(['README.md']);

/** The three template directories in oak's checkout, named so tests can resolve them. */
export function paperTemplateRoot(engineRoot: string): string {
  return join(engineRoot, 'templates', 'paper');
}
export function instanceTemplateRoot(engineRoot: string): string {
  return join(engineRoot, 'templates', 'instance');
}
export function siteTemplateRoot(engineRoot: string): string {
  return join(engineRoot, 'templates', 'site');
}

/**
 * Extracts the `myst-cli` range from oak's `package.json`. The journal site uses it as its
 * `mystmd` version [R80], so the gallery plugin and theme behave as in oak's builds. A range is
 * enough, since the Zenodo deposit, not the site, is what must be reproducible [design §7].
 */
export function engineMystRange(engineRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(engineRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  // myst-cli is a dev dependency, since it is bundled into `dist/cli.cjs` [R51]; npm keeps
  // `devDependencies` in the published package.json, so the range is readable either way.
  // `dependencies` is read too, for a fork that declares it there.
  const range = pkg.dependencies?.['myst-cli'] ?? pkg.devDependencies?.['myst-cli'];
  if (!range) throw new Error('bootstrap: engine package.json declares no myst-cli dependency');
  return range;
}

/** Every file under `dir`, recursive and relative, with posix separators. */
export function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = prefix ? posix.join(prefix, name) : name;
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Template file names and the names they are written as. npm strips a leading-dot `.gitignore`
 * from every package, so the templates hold `gitignore` and writing puts the dot back. The
 * values are exactly the names npm strips, which `templates survive npm packaging`
 * (test/template.test.ts) reads; keyed on the file name, so a file in a subdirectory is covered
 * too.
 */
export const STAMP_RENAME: Record<string, string> = { gitignore: '.gitignore' };

/** A template path and the path it is written to in the new repo. */
export function stampRel(rel: string): string {
  const parts = rel.split('/');
  const renamed = STAMP_RENAME[parts[parts.length - 1]!];
  if (!renamed) return rel;
  parts[parts.length - 1] = renamed;
  return parts.join('/');
}

/** The paths a render writes from `root` (every file but the README), under their written
 *  names, with subdirectories kept. The `template disjointness invariant` tests check these. */
export function stampedFiles(root: string): string[] {
  return listFiles(root)
    .filter((rel) => !EXCLUDE_FROM_STAMP.has(rel.split('/')[0]!))
    .map(stampRel);
}

function writeRel(destRoot: string, rel: string, contents: string | Buffer): void {
  const abs = join(destRoot, stampRel(rel));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

/** pins.yml with `engine_repo` and `instance_repo` set through the YAML Document API, keeping
 *  comments. */
export function renderPins(templateRoot: string, answers: TemplateAnswers): string {
  const doc = readDoc(join(templateRoot, RENDER_PINS));
  doc.set('engine_repo', answers.engineRepo);
  doc.set('instance_repo', answers.instanceRepo);
  return doc.toString();
}

/** A gated CODEOWNERS line: indent, path and spacing (1), the path (2), the owner column (3). */
const CODEOWNERS_LINE = /^(\s*(\S+)\s+)(\S.*)$/;

function gatedLine(line: string): RegExpExecArray | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  return CODEOWNERS_LINE.exec(line);
}

/**
 * The owner column of each gated line, by path. A column may hold several owners, and `oak
 * upgrade` passes this back to {@link renderCodeowners} so an added owner survives [R126].
 */
export function codeownersColumns(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of src.split('\n')) {
    const m = gatedLine(line);
    if (m) out[m[2]!] = m[3]!.trimEnd();
  }
  return out;
}

/** CODEOWNERS with each gated line's owner column set from `existing` for that path, or to
 *  `owner`. Edited line by line, keeping path and spacing; a column may hold several owners
 *  [R126]. */
export function renderCodeowners(
  src: string,
  owner: string,
  existing: Record<string, string> = {},
): string {
  return src
    .split('\n')
    .map((line) => {
      const m = gatedLine(line);
      return m ? m[1]! + (existing[m[2]!] ?? owner) : line;
    })
    .join('\n');
}

/** The starter myst.yml with the version, the edition and `project.github` set through the
 *  Document API. `github` goes right after `title`, where an author looks for it. */
export function renderMyst(templateRoot: string, answers: TemplateAnswers): string {
  const doc = readDoc(join(templateRoot, RENDER_MYST));
  doc.setIn(['project', 'options', 'oaktree-sapling', 'version'], answers.version);
  doc.setIn(['project', 'options', 'oaktree-sapling', 'edition'], answers.edition);
  if (answers.repo) {
    const url = `https://github.com/${answers.repo}`;
    const project = doc.get('project');
    if (isMap(project) && !project.has('github')) {
      const at = project.items.findIndex((p) => isScalar(p.key) && p.key.value === 'title');
      project.items.splice(at + 1, 0, doc.createPair('github', url));
    } else doc.setIn(['project', 'github'], url);
  }
  return doc.toString();
}

/**
 * Renders the paper template into `destRoot`: `pins.yml`, `CODEOWNERS` and `myst.yml` from the
 * settings, every other file copied, the README left out. Returns the written paths (posix).
 */
export function renderPaperTemplate(
  paperRoot: string,
  destRoot: string,
  answers: TemplateAnswers,
): string[] {
  const written: string[] = [];
  for (const rel of listFiles(paperRoot)) {
    if (EXCLUDE_FROM_STAMP.has(rel.split('/')[0]!)) continue;
    if (rel === RENDER_PINS) writeRel(destRoot, rel, renderPins(paperRoot, answers));
    else if (rel === RENDER_CODEOWNERS)
      writeRel(
        destRoot,
        rel,
        renderCodeowners(readFileSync(join(paperRoot, rel), 'utf8'), answers.owner),
      );
    else if (rel === RENDER_MYST) writeRel(destRoot, rel, renderMyst(paperRoot, answers));
    else copyRel(paperRoot, destRoot, rel);
    written.push(stampRel(rel));
  }
  return written.sort();
}

/**
 * Renders the journal template (`journal.yml`, `editions/<edition>.yml`, `brand/`, the registry)
 * into `destRoot`: the journal name from the settings into `journal.yml` (`name` and the
 * commented Zenodo blurb), the brand's `logo_text` and the edition's `venue`; the website's URL
 * into the brand's `logo_url`; the edition file renamed, the rest copied, the README left out.
 * Returns the written paths.
 */
export function renderInstanceTemplate(
  instanceRoot: string,
  destRoot: string,
  answers: TemplateAnswers,
): string[] {
  const name = answers.journalName;
  const written: string[] = [];
  for (const rel of listFiles(instanceRoot)) {
    if (EXCLUDE_FROM_STAMP.has(rel.split('/')[0]!)) continue;
    if (rel === 'journal.yml') {
      const doc = readDoc(join(instanceRoot, rel));
      if (name) doc.set('name', name);
      // What is left of the placeholder is in comments (the Zenodo blurb), so it is replaced as
      // text, on one line.
      const out = doc.toString();
      writeRel(
        destRoot,
        rel,
        name ? out.replaceAll(JOURNAL_NAME_PLACEHOLDER, name.replace(/\s+/g, ' ')) : out,
      );
    } else if (rel === posix.join('brand', 'brand.yml') && (name || answers.siteUrl)) {
      const doc = readDoc(join(instanceRoot, rel));
      if (name) doc.setIn(['site', 'options', 'logo_text'], name);
      if (answers.siteUrl) doc.setIn(['site', 'options', 'logo_url'], answers.siteUrl);
      writeRel(destRoot, rel, doc.toString());
    } else if (rel === posix.join('editions', 'edition.yml')) {
      const dest = posix.join('editions', `${answers.edition}.yml`);
      if (name) {
        const doc = readDoc(join(instanceRoot, rel));
        doc.setIn(['project', 'venue'], name);
        writeRel(destRoot, dest, doc.toString());
      } else copyFileBytes(join(instanceRoot, rel), join(destRoot, dest));
      written.push(dest);
      continue;
    } else {
      copyFileBytes(join(instanceRoot, rel), join(destRoot, rel));
    }
    written.push(stampRel(rel));
  }
  return written.sort();
}

/** The gallery plugin's URL at the release tag. Remote, since a plugin is code and a copy would
 *  go stale; pinned to the tag, so the site takes a newer gallery only when the journal bumps
 *  it. */
export function galleryPluginUrl(engineRepo: string, engineVersion: string): string {
  return `https://raw.githubusercontent.com/${engineRepo}/${engineVersion}/plugins/gallery.mjs`;
}

/** The GitHub Pages URL for `owner/repo`: a project site under a path, or the root for a repo
 *  named `<owner>.github.io`. Pages hosts are lowercase. */
export function siteUrlFor(repo: string): string {
  const [owner, name] = repo.split('/');
  const host = `${owner!.toLowerCase()}.github.io`;
  return name!.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}

/**
 * Renders the journal website (`templates/site/`) into `destRoot`, in the same repo as
 * the journal's settings for `--external`, so the registry pull request that adds a paper also
 * deploys the site.
 *
 * Written once: the journal owns every byte, `oak upgrade` never touches it and oak never reads
 * it back. Four values are rendered and the rest is copied:
 *
 *   1. the gallery plugin URL (oak's repo and tag),
 *   2. `site.template`, from `themeZipUrl()`,
 *   3. the journal name (myst.yml `project.title` and the `pages/index.md` heading),
 *   4. the `myst-cli` range, into `package.json`, beside `js-yaml`, so the site has one
 *      dependency list. The workflow runs `npm install` and `npx myst`, and is copied.
 *
 * No `project.id` (myst needs none, and ids are for papers).
 */
export function renderSiteTemplate(
  siteRoot: string,
  destRoot: string,
  answers: TemplateAnswers,
  mystRange: string,
): string[] {
  const journalName = answers.journalName ?? JOURNAL_NAME_PLACEHOLDER;
  const written: string[] = [];
  for (const rel of listFiles(siteRoot)) {
    if (EXCLUDE_FROM_STAMP.has(rel.split('/')[0]!)) continue;
    if (rel === RENDER_MYST) {
      const doc = readDoc(join(siteRoot, rel));
      doc.setIn(['project', 'title'], journalName);
      doc.setIn(['project', 'plugins', 0], galleryPluginUrl(answers.engineRepo, answers.version));
      doc.setIn(['site', 'template'], themeZipUrl());
      writeRel(destRoot, rel, doc.toString());
    } else if (rel === RENDER_SITE_INDEX || rel === RENDER_SITE_PKG) {
      // Markdown and package.json are edited as text: a structured writer would reformat them.
      const src = readFileSync(join(siteRoot, rel), 'utf8');
      writeRel(
        destRoot,
        rel,
        src.replaceAll('{{journal_name}}', journalName).replaceAll('{{myst_version}}', mystRange),
      );
    } else {
      copyRel(siteRoot, destRoot, rel);
    }
    written.push(stampRel(rel));
  }
  return written.sort();
}

function copyRel(srcRoot: string, destRoot: string, rel: string): void {
  copyFileBytes(join(srcRoot, rel), join(destRoot, stampRel(rel)));
}
function copyFileBytes(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

/* --------------------------------------------------------------------------
 * The review tree for an author's repo (pure): `.github/` comes from main
 * ------------------------------------------------------------------------ */

/**
 * The review tree: the author's content, with the whole `.github/` (`pins.yml` included) and the
 * root `CODEOWNERS` taken from `main`; the author's files at those paths are replaced. Pure, so
 * the rule is testable; `ingestReviewBranch` must do the same [R121].
 */
export function buildReviewTree(
  authorFiles: Record<string, string>,
  mainFiles: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(authorFiles)) {
    if (isEditorControlled(path)) continue; // author-side trust boundary never survives
    out[path] = content;
  }
  for (const [path, content] of Object.entries(mainFiles)) {
    if (isEditorControlled(path)) out[path] = content; // editor-side wins
  }
  return out;
}

/** The paths taken from the editors' `main`: the `.github/` subtree and CODEOWNERS. */
function isEditorControlled(path: string): boolean {
  const p = path.replace(/^\.\//, '');
  return p === '.github' || p.startsWith('.github/') || p === 'CODEOWNERS';
}

/* --------------------------------------------------------------------------
 * Provisioner (injected; the real one is in gh.ts)
 * ------------------------------------------------------------------------ */

/** A required reviewer on a deployment environment: a GitHub team or user, by numeric id. */
export interface EnvironmentReviewer {
  type: 'Team' | 'User';
  id: number;
}

export interface Provisioner {
  /** 'Organization' or 'User' for an owner, which decides between a team grant and an admin
   *  bypass. */
  ownerType(owner: string): 'Organization' | 'User';
  repoExists(repo: string): boolean;
  createRepo(repo: string, opts: { private: boolean; description: string }): void;
  branchExists(repo: string, branch: string): boolean;
  /** The repo's default branch: an existing repo may not use `main` [R127]. */
  defaultBranch(repo: string): string;
  setDefaultBranch(repo: string, branch: string): void;
  /** Seeds `branch` of `repo` with one commit from a prepared directory, and pushes. */
  seedBranch(repo: string, branch: string, sourceDir: string, message: string): void;
  /**
   * Builds a `review` branch: the author's content (`sourceUrl` at `sourceRef`) with the whole
   * `.github/` from `origin/main`, and pushes it. Needs `main` seeded.
   */
  ingestReviewBranch(
    repo: string,
    opts: { sourceUrl: string; sourceRef: string; message: string },
  ): void;
  prExists(repo: string, head: string): boolean;
  openPr(repo: string, opts: { head: string; base: string; title: string; body: string }): string;
  /** Gives `org/team` write access to `repo` (org repos only). */
  grantTeamWrite(repo: string, team: string): void;
  /** A team's numeric id, to let it bypass the `v*` tag ruleset (orgs). */
  teamId(team: string): number;
  rulesetExists(repo: string, name: string): boolean;
  createRuleset(repo: string, body: unknown): void;
  pagesEnabled(repo: string): boolean;
  enablePages(repo: string): void;
  /** The repo's "About" website; '' when none. */
  homepage(repo: string): string;
  setHomepage(repo: string, url: string): void;
  /** Whether Actions may create and approve pull requests on `repo` ([R122]). */
  actionsCanApprovePrs(repo: string): boolean;
  /** Lets Actions create and approve pull requests, keeping the default token permission [R122]. */
  allowActionsApprovePrs(repo: string): void;
  environmentExists(repo: string, name: string): boolean;
  /** `name`'s required reviewers, so a rerun keeps one added by hand [R127]. */
  environmentReviewers(repo: string, name: string): EnvironmentReviewer[];
  upsertEnvironment(repo: string, name: string, reviewers: EnvironmentReviewer[]): void;
  /** Whether `env` admits only the refs its deployment policies name; GitHub creates environments
   *  open to every branch. */
  customBranchPolicies(repo: string, env: string): boolean;
  branchPolicyExists(repo: string, env: string, name: string): boolean;
  createBranchPolicy(repo: string, env: string, name: string, type: string): void;
  createLabel(repo: string, name: string, opts: { color?: string; description?: string }): void;
  setSecret(repo: string, env: string, name: string, value: string): void;
  /** Secret names on `env`, or the repo's when `env` is omitted; [] when none. */
  secretNames(repo: string, env?: string): string[];
  deleteRepoSecret(repo: string, name: string): void;
  /** `owner/repo`'s visibility, to require a public journal repo. */
  repoVisibility(repo: string): 'public' | 'private';
  setRepoPublic(repo: string): void;
}

/* --------------------------------------------------------------------------
 * Ruleset bodies
 * ------------------------------------------------------------------------ */

export const RULESET_PROTECT_MAIN = 'protect-main';
export const RULESET_V_TAGS = 'editors-only-v-tags';

/** GitHub's id for the repo admin role, as a ruleset `RepositoryRole` bypass actor. */
const REPO_ROLE_ADMIN = 5;

function protectMainBody(requireChecks: boolean, bypass: unknown[]): unknown {
  const rules: unknown[] = [
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        require_code_owner_review: true,
        dismiss_stale_reviews_on_push: true,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        // GitHub defaults this on, which asks for an approving review of a pull request no person
        // authored, such as the DOI pull request `oak deposit prepare` opens.
        require_extra_approval_for_unattributed_changes: false,
      },
    },
  ];
  // The Journal checks must pass before a merge: this is what enforces the paper id, which does
  // not block the build. On by default; `--no-require-checks` turns it off. The bypass below
  // applies to this rule too, since a bypass is per ruleset [R127].
  if (requireChecks) {
    rules.push({
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'Journal checks' }],
        strict_required_status_checks_policy: false,
      },
    });
  }
  return {
    name: RULESET_PROTECT_MAIN,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules,
    bypass_actors: bypass,
  };
}

/** Who may merge a pull request the rules would block: nobody on an org, the repo
 *  admin on a personal account, where the sole editor cannot approve as code owner. `pull_request`
 *  mode, so pushing directly to main stays refused [R127]. */
function protectMainBypass(team: string | null): unknown[] {
  return team
    ? []
    : [{ actor_id: REPO_ROLE_ADMIN, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }];
}

function vTagsBody(bypass: unknown[]): unknown {
  return {
    name: RULESET_V_TAGS,
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    rules: [{ type: 'creation' }, { type: 'update' }, { type: 'deletion' }],
    bypass_actors: bypass,
  };
}

/* --------------------------------------------------------------------------
 * Labels + secrets
 * ------------------------------------------------------------------------ */

const LABELS: Array<{ name: string; color: string; description: string }> = [
  { name: LABEL_EDITOR_ACTION, color: 'b60205', description: msg.bootstrap.labelEditorAction },
  { name: LABEL_ZENODO_FAILED, color: 'b60205', description: msg.bootstrap.labelZenodoFailed },
];

export interface SecretInputs {
  zenodoToken?: string;
  zenodoTokenSandbox?: string;
  cfToken?: string;
  cfAccount?: string;
}

/** The name of the environment gating the tag-push deposit. */
export const ZENODO_ENV = 'zenodo-publish';
/** The environment of the DOI-reservation workflow: `main` only, no reviewer. */
export const ZENODO_PREPARE_ENV = 'zenodo-prepare';
/** The environment of the preview deploy: `main` only, no reviewer. */
export const PREVIEW_ENV = 'preview';

/** Secrets live in environments only: a repo secret reaches every branch ([R207]). */
export const SECRET_MAP: Array<{ key: keyof SecretInputs; name: string; envs: string[] }> = [
  { key: 'zenodoToken', name: 'ZENODO_TOKEN', envs: [ZENODO_ENV, ZENODO_PREPARE_ENV] },
  {
    key: 'zenodoTokenSandbox',
    name: 'ZENODO_TOKEN_SANDBOX',
    envs: [ZENODO_ENV, ZENODO_PREPARE_ENV],
  },
  { key: 'cfToken', name: 'CLOUDFLARE_API_TOKEN', envs: [PREVIEW_ENV] },
  { key: 'cfAccount', name: 'CLOUDFLARE_ACCOUNT_ID', envs: [PREVIEW_ENV] },
];

/** The environments admitting only `main`, beside the `v*`-only {@link ZENODO_ENV}. */
const MAIN_ONLY_ENVS = [ZENODO_PREPARE_ENV, PREVIEW_ENV];

/* --------------------------------------------------------------------------
 * Orchestration
 * ------------------------------------------------------------------------ */

export interface BootstrapDeps {
  prov: Provisioner;
  /** `templates/paper/` in oak's checkout. */
  paperTemplateRoot: string;
  /** `templates/instance/` in oak's checkout. */
  instanceTemplateRoot: string;
  /** `templates/site/` in oak's checkout, the journal website [R80]. */
  siteTemplateRoot: string;
  /** oak's own `myst-cli` range, for the site ({@link engineMystRange}). */
  mystRange: string;
  log(msg: string): void;
  /** Prints the plan and asks to proceed. Tests pass `() => true`; the CLI handles --yes and the
   *  TTY. */
  confirm(plan: string[]): Promise<boolean>;
  /** A new temporary directory for rendering the seed (default: the OS temp dir). */
  workdir(): string;
}

export interface Outcome {
  exitCode: number;
  result: Record<string, unknown>;
}

/**
 * Where each value the user did not type came from, so the plan can say so. Only the CLI knows:
 * by the time a value arrives here, a default and a typed value look the same.
 */
export interface ResolvedFlags {
  engineVersionFrom?: 'flag' | 'latest-release';
  engineRepoFrom?: 'flag' | 'default';
}

/**
 * The plan's opening block: every value the run will use, and whether it came from a flag or a
 * default. `Proceed? [y/N]` is consent only if the defaults are on screen above it, and most end
 * up in files that are awkward to change later.
 */
function declaredValues(v: {
  engineVersion: string;
  engineRepo: string;
  owner: string;
  ownerGiven: boolean;
  /** Whether this run uses the owner: an external journal repo gets no CODEOWNERS and no
   *  team grant, so showing one there would promise something unused. */
  ownerUsed: boolean;
  edition: string;
  editionGiven: boolean;
  /** The journal's name: a string when given, `null` on a journal run without one, `undefined`
   *  for a paper. */
  journalName?: string | null;
  instanceRepo?: string;
  resolved?: ResolvedFlags;
}): string[] {
  const rows: Array<[string, string]> = [];
  if (v.instanceRepo) {
    rows.push([
      msg.declared.labels.journalRepo,
      v.instanceRepo === '.'
        ? msg.declared.journalRepoCoLocated
        : msg.declared.journalRepo(v.instanceRepo),
    ]);
  }
  if (v.journalName !== undefined) {
    rows.push([
      msg.declared.labels.journalName,
      v.journalName
        ? msg.declared.journalNameGiven(v.journalName)
        : msg.declared.journalNameDefault,
    ]);
  }
  rows.push([
    msg.declared.labels.edition,
    v.editionGiven ? msg.declared.editionGiven(v.edition) : msg.declared.editionDefault(v.edition),
  ]);
  rows.push([
    msg.declared.labels.engineVersion,
    v.resolved?.engineVersionFrom === 'flag'
      ? msg.declared.engineVersionGiven(v.engineVersion)
      : msg.declared.engineVersionDefault(v.engineVersion),
  ]);
  rows.push([
    msg.declared.labels.engineRepo,
    v.resolved?.engineRepoFrom === 'flag'
      ? msg.declared.engineRepoGiven(v.engineRepo)
      : msg.declared.engineRepoDefault(v.engineRepo),
  ]);
  if (v.ownerUsed) {
    rows.push([
      msg.declared.labels.owner,
      v.ownerGiven ? msg.declared.ownerGiven(v.owner) : msg.declared.ownerDefault(v.owner),
    ]);
  }
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, val]) => `  ${k.padEnd(width)} : ${val}`);
}

export interface BootstrapPaperInput {
  repo: string; // owner/name
  from?: string; // author url (ingest mode); bare when absent
  sourceRef?: string;
  instance?: string; // owner/instance-config; '.' co-located
  /** The paper's edition in its journal. Required (see cmdBootstrapPaper). */
  edition?: string;
  engineVersion: string;
  engineRepo: string; // resolved engine repo for pins.yml
  owner?: string; // @user | @org/team
  authedUser: string; // gh api user login (personal-account default owner)
  private: boolean;
  requireChecks: boolean; // add "Journal checks" to protect-main required checks (default true)
  secrets: SecretInputs;
  /** Where the defaulted values came from, for the plan. */
  resolved?: ResolvedFlags;
}

/** The owner of `owner/repo`. */
function repoOwner(repo: string): string {
  return repo.split('/')[0]!;
}

/** The CODEOWNERS owner and the team, if any, from --owner or the logged-in user. */
function resolveOwner(
  input: { owner?: string; authedUser: string; repo: string },
  prov: Provisioner,
): { ownerToken: string; team: string | null; ownerType: 'Organization' | 'User' } {
  const login = repoOwner(input.repo);
  const ownerType = prov.ownerType(login);
  const ownerToken = input.owner ?? `@${input.authedUser}`;
  // A team grant needs an `@org/team` owner on an org.
  const team =
    ownerType === 'Organization' && /^@[^/]+\/.+$/.test(ownerToken) ? ownerToken.slice(1) : null;
  return { ownerToken, team, ownerType };
}

/** What a partial run leaves behind [R125]. */
export interface StepFailure {
  step: string;
  why: string;
}

/** Runs one step, recording an error rather than throwing it [R125]. false when it failed. */
function stepRunner(
  repo: string,
  actions: Record<string, string>,
  runbook: string[],
  failed: StepFailure[],
  log: (m: string) => void,
): (step: string, body: () => void) => boolean {
  return (step, body) => {
    try {
      body();
      return true;
    } catch (e) {
      const why = firstLine(e);
      actions[step] = `failed: ${why}`;
      failed.push({ step, why });
      log(msg.bootstrap.logStepFailed(step, why));
      runbook.push(msg.bootstrap.runbookStepFailed(repo, step, why));
      return false;
    }
  };
}

/** Returns early from a fatal step with a partial result [R125]. */
function partial(
  repo: string,
  extra: Record<string, unknown>,
  actions: Record<string, string>,
  runbook: string[],
  failed: StepFailure[],
  log: (m: string) => void,
): Outcome {
  for (const line of runbook) log(`  → ${line}`);
  log(msg.bootstrap.logPartial(failed.map((f) => f.step).join(', ')));
  return {
    exitCode: 1,
    result: {
      status: 'incomplete',
      repo,
      ...extra,
      actions,
      runbook,
      failed: failed.map((f) => `${f.step}: ${f.why}`),
    },
  };
}

/** Turns on Pages and links the Pages URL from the repo page. The link is set only when empty,
 *  so a rerun keeps one set by hand. */
function pagesSteps(
  repo: string,
  prov: Provisioner,
  step: (step: string, body: () => void) => boolean,
  actions: Record<string, string>,
  log: (m: string) => void,
): void {
  step('pages', () => {
    if (prov.pagesEnabled(repo)) {
      actions.pages = 'already enabled';
      log(msg.bootstrap.logPagesExists);
    } else {
      prov.enablePages(repo);
      actions.pages = 'enabled';
      log(msg.bootstrap.logPagesEnabled);
    }
  });

  step('homepage', () => {
    const current = prov.homepage(repo);
    if (current) {
      actions.homepage = 'already set';
      log(msg.bootstrap.logHomepageExists(current));
    } else {
      const url = siteUrlFor(repo);
      prov.setHomepage(repo, url);
      actions.homepage = 'set';
      log(msg.bootstrap.logHomepageSet(url));
    }
  });
}

/** Sets up the repo's settings. Returns the runbook lines and the steps that failed
 *  [R125]. */
function applyProvisioning(
  repo: string,
  owner: { ownerToken: string; team: string | null; ownerType: 'Organization' | 'User' },
  deps: BootstrapDeps,
  actions: Record<string, string>,
  requireChecks: boolean,
): { runbook: string[]; failed: StepFailure[] } {
  const { prov, log } = deps;
  const runbook: string[] = [];
  const failed: StepFailure[] = [];
  const step = stepRunner(repo, actions, runbook, failed, log);

  if (owner.team) {
    const team = owner.team;
    step('team_grant', () => {
      prov.grantTeamWrite(repo, team);
      actions.team_grant = `granted ${team} write`;
      log(msg.bootstrap.logTeamGranted(team));
    });
  }

  // An existing repo may default to another branch: `seedBranch` writes `main` and leaves
  // `default_branch` alone, so protect-main would guard a branch nothing merges to [R127]. Runs
  // before the ruleset that depends on it.
  step('default_branch', () => {
    const current = prov.defaultBranch(repo);
    if (current === 'main') {
      actions.default_branch = 'already main';
      return;
    }
    prov.setDefaultBranch(repo, 'main');
    actions.default_branch = `switched from ${current}`;
    log(msg.bootstrap.logDefaultBranch(current));
  });

  step('protect_main', () => {
    if (prov.rulesetExists(repo, RULESET_PROTECT_MAIN)) {
      actions.protect_main = 'already exists';
      log(msg.bootstrap.logRulesetExists(RULESET_PROTECT_MAIN));
    } else {
      prov.createRuleset(repo, protectMainBody(requireChecks, protectMainBypass(owner.team)));
      actions.protect_main = 'created';
      log(msg.bootstrap.logRulesetCreated(RULESET_PROTECT_MAIN));
    }
  });

  step('v_tags', () => {
    const bypass = owner.team
      ? [{ actor_id: prov.teamId(owner.team), actor_type: 'Team', bypass_mode: 'always' }]
      : [{ actor_id: REPO_ROLE_ADMIN, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
    if (prov.rulesetExists(repo, RULESET_V_TAGS)) {
      actions.v_tags = 'already exists';
      log(msg.bootstrap.logTagRuleExists(RULESET_V_TAGS));
    } else {
      prov.createRuleset(repo, vTagsBody(bypass));
      actions.v_tags = 'created';
      log(msg.bootstrap.logTagRuleCreated(RULESET_V_TAGS));
    }
  });

  pagesSteps(repo, prov, step, actions, log);

  // Actions can open a pull request only when the repo allows it, and the DOI write is a
  // pull request opened by an Action, so every first deposit needs this [R122].
  step('actions_pull_requests', () => {
    if (prov.actionsCanApprovePrs(repo)) {
      actions.actions_pull_requests = 'already allowed';
      log(msg.bootstrap.logActionsPrsExists);
    } else {
      prov.allowActionsApprovePrs(repo);
      actions.actions_pull_requests = 'allowed';
      log(msg.bootstrap.logActionsPrsAllowed);
    }
  });

  // GitHub creates a named environment open to every branch; the PUT keeps reviewers [R127].
  const restrict = (env: string) => {
    if (!prov.environmentExists(repo, env)) prov.upsertEnvironment(repo, env, []);
    else if (!prov.customBranchPolicies(repo, env))
      prov.upsertEnvironment(repo, env, prov.environmentReviewers(repo, env));
  };

  // No required reviewer [R123]: only editors push `v*` tags, the environment admits only them,
  // and the Zenodo draft waits for an editor's Publish click.
  step('zenodo_env', () => {
    restrict(ZENODO_ENV);
    if (prov.branchPolicyExists(repo, ZENODO_ENV, 'v*')) {
      actions.zenodo_env = 'v* policy already exists';
      log(msg.bootstrap.logZenodoEnvExists);
    } else {
      prov.createBranchPolicy(repo, ZENODO_ENV, 'v*', 'tag');
      actions.zenodo_env = 'created with v* policy';
      log(msg.bootstrap.logZenodoEnvCreated);
    }
  });

  for (const env of MAIN_ONLY_ENVS) {
    step(`env_${env}`, () => {
      restrict(env);
      if (prov.branchPolicyExists(repo, env, 'main')) {
        actions[`env_${env}`] = 'main policy already exists';
        log(msg.bootstrap.logMainEnvExists(env));
      } else {
        prov.createBranchPolicy(repo, env, 'main', 'branch');
        actions[`env_${env}`] = 'created with main policy';
        log(msg.bootstrap.logMainEnvCreated(env));
      }
    });
  }

  step('labels', () => {
    for (const l of LABELS)
      prov.createLabel(repo, l.name, { color: l.color, description: l.description });
    actions.labels = LABELS.map((l) => l.name).join(', ');
  });

  return { runbook, failed };
}

/** Sets secrets on their environments, then deletes the repo-level copies those
 *  environments now hold; any other copy is kept, since its value cannot be read back [R25]. */
function applySecrets(
  repo: string,
  secrets: SecretInputs,
  deps: BootstrapDeps,
  actions: Record<string, string>,
): { set: string[]; runbook: string[]; failed: StepFailure[] } {
  const { prov } = deps;
  const set: string[] = [];
  const runbook: string[] = [];
  const failed: StepFailure[] = [];
  const step = stepRunner(repo, actions, runbook, failed, deps.log);
  const held = new Map<string, Set<string>>();
  const heldOn = (env: string): Set<string> => {
    if (!held.has(env)) held.set(env, new Set(prov.secretNames(repo, env)));
    return held.get(env)!;
  };
  for (const { key, name, envs } of SECRET_MAP) {
    const value = secrets[key];
    if (!value) continue;
    let all = true;
    for (const env of envs) {
      // Per secret and environment, so one refusal does not stop the rest [R125].
      const ok = step(`secret_${env}_${name}`, () => {
        prov.setSecret(repo, env, name, value);
        deps.log(msg.bootstrap.logSecretSet(name, env));
      });
      if (ok) heldOn(env).add(name);
      all &&= ok;
    }
    if (all) set.push(name);
  }

  const missing = SECRET_MAP.flatMap(({ name, envs }) => {
    const lacking = envs.filter((env) => !heldOn(env).has(name));
    return lacking.length ? [`${name} (${lacking.join(', ')})`] : [];
  });
  if (missing.length) runbook.push(msg.bootstrap.runbookSecrets(repo, missing.join('; ')));

  step('repo_secrets', () => {
    const repoLevel = new Set(prov.secretNames(repo));
    const removed: string[] = [];
    const kept: string[] = [];
    for (const { name, envs } of SECRET_MAP) {
      if (!repoLevel.has(name)) continue;
      if (envs.every((env) => heldOn(env).has(name))) {
        prov.deleteRepoSecret(repo, name);
        removed.push(name);
        deps.log(msg.bootstrap.logRepoSecretDeleted(name));
      } else kept.push(name);
    }
    if (kept.length) runbook.push(msg.bootstrap.runbookRepoSecrets(repo, kept.join(', ')));
    actions.repo_secrets = removed.length ? `deleted ${removed.join(', ')}` : 'none deleted';
  });

  runbook.push(msg.bootstrap.runbookForkApproval);
  runbook.push(msg.bootstrap.runbookAuthorAccess(repo));
  return { set, runbook, failed };
}

export async function cmdBootstrapPaper(
  input: BootstrapPaperInput,
  deps: BootstrapDeps,
): Promise<Outcome> {
  const { prov, log } = deps;
  const { repo } = input;
  const mode = input.from ? 'ingest' : 'bare';

  // `--instance` is required: `pins.yml`'s `instance_repo` is the only record of a paper's
  // journal, and with `.` the engine action clones nothing, so `oak validate` and `oak build`
  // would fail in CI with no journal. `--instance .` stays the explicit choice for a repo
  // that is its own journal (`oak bootstrap journal --co-located` renders the paper template
  // itself and does not come through here).
  if (!input.instance) {
    return {
      exitCode: 2,
      result: {
        status: 'error',
        repo,
        error: msg.bootstrap.instanceRequired,
      },
    };
  }
  // `--edition` is required for the same reason: it is written into the paper's myst.yml, and the
  // journal must already have `editions/<id>.yml` under that name, so a default would only fail
  // later in CI. (`bootstrap journal` may default it: there the same value names the edition
  // file it writes.)
  if (!input.edition) {
    return {
      exitCode: 2,
      result: {
        status: 'error',
        repo,
        error: msg.bootstrap.editionRequired(input.instance),
      },
    };
  }
  const owner = resolveOwner(input, prov);

  const instanceRepo = input.instance;
  const answers: TemplateAnswers = {
    engineRepo: input.engineRepo,
    instanceRepo,
    owner: owner.ownerToken,
    version: input.engineVersion,
    edition: input.edition,
    repo,
  };

  // ---- Read the current state, so a rerun is safe ----
  const repoThere = prov.repoExists(repo);
  const mainThere = repoThere && prov.branchExists(repo, 'main');
  const reviewThere = repoThere && mode === 'ingest' && prov.branchExists(repo, 'review');
  const prThere = reviewThere && prov.prExists(repo, 'review');

  const plan = [
    msg.bootstrap.paperPlanHeader(mode, repo),
    ...declaredValues({
      engineVersion: input.engineVersion,
      engineRepo: input.engineRepo,
      owner: owner.ownerToken,
      ownerGiven: Boolean(input.owner),
      ownerUsed: true,
      edition: input.edition,
      editionGiven: true, // required for papers, never defaulted
      instanceRepo,
      resolved: input.resolved,
    }),
    repoThere ? msg.bootstrap.planRepoExists : msg.bootstrap.planCreateRepo(input.private),
    // The last point to say so before content exists [R127].
    ...(input.private ? [msg.bootstrap.planPrivate] : []),
    mainThere ? msg.bootstrap.planMainSeeded : msg.bootstrap.planSeedPaper,
    // A rerun does not seed again, so rerunning with a different answer (`--instance`,
    // `--engine-version`) keeps the earlier pins.yml and changes nothing.
    ...(mainThere ? [msg.bootstrap.planAlreadySeededPaper(instanceRepo)] : []),
    ...(mode === 'ingest'
      ? [
          reviewThere
            ? msg.bootstrap.planReviewBranchExists
            : msg.bootstrap.planReviewBranch(input.from!, input.sourceRef ?? 'main'),
          prThere ? msg.bootstrap.planReviewPrExists : msg.bootstrap.planReviewPr,
        ]
      : []),
    msg.bootstrap.planProvisioning,
    msg.bootstrap.planSecrets(
      SECRET_MAP.filter((s) => input.secrets[s.key])
        .map((s) => s.name)
        .join(', '),
    ),
  ];
  if (!(await deps.confirm(plan)))
    return {
      exitCode: 0,
      result: {
        status: 'aborted',
        repo,
        mode,
        reason: msg.prompt.abortedNothingCreated,
      },
    };

  const actions: Record<string, string> = {};
  const contentRunbook: string[] = [];
  const contentFailed: StepFailure[] = [];
  const step = stepRunner(repo, actions, contentRunbook, contentFailed, log);

  // Content steps depend on each other; settings steps do not [R125].
  if (!repoThere) {
    const created = step('repo', () => {
      prov.createRepo(repo, {
        private: input.private,
        description: msg.bootstrap.descriptionPaper,
      });
      actions.repo = 'created';
      log(msg.bootstrap.logCreated(repo));
    });
    // Fatal: nothing else can act on a repo that does not exist [R125].
    if (!created) return partial(repo, { mode }, actions, contentRunbook, contentFailed, log);
  } else actions.repo = 'exists';

  // Render the paper seed once; it is used to seed main.
  const seedDir = deps.workdir();
  renderPaperTemplate(deps.paperTemplateRoot, seedDir, answers);

  let mainSeeded = mainThere;
  if (!mainThere) {
    mainSeeded = step('main', () => {
      prov.seedBranch(repo, 'main', seedDir, 'startpoint');
      actions.main = 'seeded';
      log(msg.bootstrap.logSeeded);
    });
  } else actions.main = 'exists';

  let prUrl: string | undefined;
  // Without main there is no `.github/` to restore and no base for a pull request; the settings
  // are still set below.
  if (mode === 'ingest' && mainSeeded) {
    let reviewReady = reviewThere;
    if (!reviewThere) {
      reviewReady = step('review', () => {
        prov.ingestReviewBranch(repo, {
          sourceUrl: input.from!,
          sourceRef: input.sourceRef ?? 'main',
          message: msg.bootstrap.ingestCommitMessage(input.from!),
        });
        actions.review = 'ingested';
        log(msg.bootstrap.logReviewBranch);
      });
    } else actions.review = 'exists';

    if (!prThere && reviewReady) {
      step('pr', () => {
        prUrl = prov.openPr(repo, {
          head: 'review',
          base: 'main',
          title: msg.bootstrap.ingestPrTitle(repoOwner(repo)),
          body: msg.bootstrap.ingestPrBody(input.from!),
        });
        actions.pr = 'opened';
        log(msg.bootstrap.logPrOpened(prUrl));
      });
    } else if (prThere) actions.pr = 'exists';
  }

  const prov_ = applyProvisioning(repo, owner, deps, actions, input.requireChecks);
  const {
    set,
    runbook: secretRunbook,
    failed: secretFailed,
  } = applySecrets(repo, input.secrets, deps, actions);
  // The starter myst.yml holds placeholders; an ingested paper brings the author's own.
  const fill =
    mode === 'bare' && actions.main === 'seeded' ? [msg.bootstrap.runbookFillPaper(repo)] : [];
  const runbook = [...fill, ...contentRunbook, ...prov_.runbook, ...secretRunbook];
  const failed = [...contentFailed, ...prov_.failed, ...secretFailed];
  for (const line of runbook) log(`  → ${line}`);
  if (failed.length) log(msg.bootstrap.logPartial(failed.map((f) => f.step).join(', ')));

  return {
    exitCode: failed.length ? 1 : 0,
    result: {
      status: failed.length ? 'incomplete' : 'ok',
      repo,
      mode,
      actions,
      secrets_set: set,
      runbook,
      ...(failed.length ? { failed: failed.map((f) => `${f.step}: ${f.why}`) } : {}),
      ...(prUrl ? { pr: prUrl } : {}),
    },
  };
}

/** The edition when `--edition` is not given. Consistent, since it also names the
 *  `editions/<id>.yml` this run writes, and shown in the plan. */
const DEFAULT_EDITION = 'edition';

export interface BootstrapJournalInput {
  repo: string; // owner/name
  tier: 'external' | 'co-located';
  name?: string;
  /** Defaults to {@link DEFAULT_EDITION}, shown in the plan. */
  edition?: string;
  engineVersion: string;
  engineRepo: string;
  owner?: string;
  authedUser: string;
  requireChecks: boolean; // add "Journal checks" to protect-main required checks (default true)
  /** `--external` only: also write the journal website and turn on Pages. Default true; `--no-site`
   *  gives a settings repo with no website [design §2]. `site: false` with `--co-located`
   *  is a usage error: that kind never gets a site, so the flag would do nothing. */
  site?: boolean;
  secrets: SecretInputs;
  /** Where the defaulted values came from, for the plan. */
  resolved?: ResolvedFlags;
}

export async function cmdBootstrapJournal(
  input: BootstrapJournalInput,
  deps: BootstrapDeps,
): Promise<Outcome> {
  const { prov, log } = deps;
  const { repo } = input;
  const external = input.tier === 'external';
  if (!external && input.site === false) {
    return {
      exitCode: 2,
      result: {
        status: 'error',
        repo,
        error: msg.bootstrap.noSiteNeedsExternal,
      },
    };
  }
  const withSite = external && input.site !== false;
  const owner = resolveOwner(input, prov);
  const edition = input.edition ?? DEFAULT_EDITION;

  const answers: TemplateAnswers = {
    engineRepo: input.engineRepo,
    instanceRepo: '.', // co-located: this repo IS the instance; external: unused
    owner: owner.ownerToken,
    version: input.engineVersion,
    edition,
    journalName: input.name,
    repo,
    ...(withSite ? { siteUrl: siteUrlFor(repo) } : {}),
  };

  const repoThere = prov.repoExists(repo);
  const mainThere = repoThere && prov.branchExists(repo, 'main');

  const plan = [
    msg.bootstrap.journalPlanHeader(external, repo),
    ...declaredValues({
      engineVersion: input.engineVersion,
      engineRepo: input.engineRepo,
      owner: owner.ownerToken,
      ownerGiven: Boolean(input.owner),
      // An external journal repo gets no CODEOWNERS and no team grant, so the plan shows no
      // owner.
      ownerUsed: !external,
      edition,
      editionGiven: Boolean(input.edition),
      journalName: input.name ?? null,
      resolved: input.resolved,
    }),
    repoThere ? msg.bootstrap.planRepoExists : msg.bootstrap.planCreateJournalRepo(external),
    mainThere
      ? msg.bootstrap.planMainSeeded
      : external
        ? msg.bootstrap.planSeedJournal(withSite)
        : msg.bootstrap.planSeedCoLocated,
    external
      ? withSite
        ? msg.bootstrap.planPages(siteUrlFor(repo))
        : msg.bootstrap.planNoSite
      : msg.bootstrap.planProvisioningCoLocated,
    // As for papers, a rerun does not seed again, so a changed `--name`, `--edition` or
    // `--engine-version` does not reach a seeded main.
    ...(mainThere ? [msg.bootstrap.planAlreadySeededJournal] : []),
  ];
  if (!(await deps.confirm(plan)))
    return {
      exitCode: 0,
      result: {
        status: 'aborted',
        repo,
        tier: input.tier,
        reason: msg.prompt.abortedNothingCreated,
      },
    };

  const actions: Record<string, string> = {};
  const contentRunbook: string[] = [];
  const contentFailed: StepFailure[] = [];
  const step = stepRunner(repo, actions, contentRunbook, contentFailed, log);

  if (!repoThere) {
    const created = step('repo', () => {
      prov.createRepo(repo, {
        private: false,
        description: external
          ? msg.bootstrap.descriptionJournal
          : msg.bootstrap.descriptionCoLocated,
      });
      actions.repo = 'created (public)';
      log(msg.bootstrap.logCreatedPublic(repo));
    });
    // Fatal: nothing else can act on a repo that does not exist [R125].
    if (!created)
      return partial(repo, { tier: input.tier }, actions, contentRunbook, contentFailed, log);
  } else {
    actions.repo = 'exists';
    // Journal repos must be public [R32] [R189]; checked on a rerun too.
    step('visibility', () => {
      if (prov.repoVisibility(repo) === 'private') {
        prov.setRepoPublic(repo);
        actions.visibility = 'forced public';
        log(msg.bootstrap.logMadePublic);
      }
    });
  }

  const seedDir = deps.workdir();
  if (external) {
    renderInstanceTemplate(deps.instanceTemplateRoot, seedDir, answers);
    // The website shares the repo with the journal's settings. The two templates write
    // different paths (`template disjointness invariant` in test/template.test.ts), so they are
    // rendered one after the other.
    if (withSite) renderSiteTemplate(deps.siteTemplateRoot, seedDir, answers, deps.mystRange);
  } else {
    renderPaperTemplate(deps.paperTemplateRoot, seedDir, answers); // the paper, `instance_repo: .`
    renderInstanceTemplate(deps.instanceTemplateRoot, seedDir, answers); // its journal settings
  }

  if (!mainThere) {
    step('main', () => {
      prov.seedBranch(repo, 'main', seedDir, 'startpoint');
      actions.main = 'seeded';
      log(msg.bootstrap.logSeeded);
    });
  } else actions.main = 'exists';

  if (!external) {
    const settings = applyProvisioning(repo, owner, deps, actions, input.requireChecks);
    const secrets = applySecrets(repo, input.secrets, deps, actions);
    const fill = actions.main === 'seeded' ? [msg.bootstrap.runbookFillPaper(repo)] : [];
    const runbook = [...fill, ...contentRunbook, ...settings.runbook, ...secrets.runbook];
    const failed = [...contentFailed, ...settings.failed, ...secrets.failed];
    for (const line of runbook) log(`  → ${line}`);
    if (failed.length) log(msg.bootstrap.logPartial(failed.map((f) => f.step).join(', ')));
    return {
      exitCode: failed.length ? 1 : 0,
      result: {
        status: failed.length ? 'incomplete' : 'ok',
        repo,
        tier: input.tier,
        actions,
        secrets_set: secrets.set,
        runbook,
        ...(failed.length ? { failed: failed.map((f) => `${f.step}: ${f.why}`) } : {}),
      },
    };
  }

  // --- external -------------------------------------------------------------------
  // No rulesets or branch protection on the journal repo: adding a paper to the registry
  // is a pull request into a repo only editors can write, and protecting it is the
  // journal's call, as with `--no-require-checks` for papers. The runbook mentions it.
  const runbook: string[] = [
    msg.bootstrap.runbookStartHere(repo),
    msg.bootstrap.runbookNoProtection,
  ];
  if (!withSite) {
    const allRunbook = [...contentRunbook, ...runbook];
    for (const line of contentRunbook) log(`  → ${line}`);
    return {
      exitCode: contentFailed.length ? 1 : 0,
      result: {
        status: contentFailed.length ? 'incomplete' : 'ok',
        repo,
        tier: input.tier,
        actions,
        runbook: allRunbook,
        ...(contentFailed.length
          ? { failed: contentFailed.map((f) => `${f.step}: ${f.why}`) }
          : {}),
      },
    };
  }

  // Pages, through the same read-first calls the paper path uses.
  pagesSteps(repo, prov, step, actions, log);

  const siteUrl = siteUrlFor(repo);
  actions.site = 'stamped';
  log(msg.bootstrap.logSiteAdded(siteUrl));
  runbook.push(msg.bootstrap.runbookSite(siteUrl), msg.bootstrap.runbookSiteFailure);
  const allRunbook = [...contentRunbook, ...runbook];
  for (const line of allRunbook) log(`  → ${line}`);
  if (contentFailed.length)
    log(msg.bootstrap.logPartial(contentFailed.map((f) => f.step).join(', ')));

  return {
    exitCode: contentFailed.length ? 1 : 0,
    result: {
      status: contentFailed.length ? 'incomplete' : 'ok',
      repo,
      tier: input.tier,
      actions,
      site_url: siteUrl,
      runbook: allRunbook,
      ...(contentFailed.length ? { failed: contentFailed.map((f) => `${f.step}: ${f.why}`) } : {}),
    },
  };
}
