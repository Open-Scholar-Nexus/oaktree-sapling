/**
 * `oak upgrade`: renders a paper's engine-managed files at a target version from the repo's own
 * settings (`pins.yml`, `CODEOWNERS`), compares them with the files on disk, and opens a pull
 * request. Engine-managed files are never edited by hand, so any difference is reset to the template;
 * a deliberate edit still shows in the pull request. Nothing records a template version.
 *
 *  - **version-only** sets `project.options.oaktree-sapling.version` in `myst.yml`. Not gated.
 *  - **files-only** overwrites the engine-managed files that differ, so the pull request needs a
 *    CODEOWNERS review.
 *  - **both** does both.
 *
 * A repo that is up to date gets no pull request. Without `--to`, the target is the newest stable
 * release, and a pin already past it stays. That run reuses one branch, so its pull request is
 * updated in place; a `--to` pick gets a branch of its own. Finding the target, getting the
 * template and opening the pull request are injected, so tests use fakes.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { readDoc, writeDoc } from './yaml-io.js';
import {
  renderPins,
  renderCodeowners,
  codeownersColumns,
  type TemplateAnswers,
} from './bootstrap.js';
import * as msg from './messages.js';
import type { cmdConformanceReset } from './conformance.js';

/** The branch for the newest release; a `--to` pick adds `-<tag>`. Exported for
 *  {@link cmdConformanceReset}, which deletes both [R117]. */
export const UPGRADE_BRANCH = 'oak/upgrade';

/** A release tag: `vX.Y.Z`, optionally with a pre-release such as `-dev.4`. */
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Semver order of two release tags (negative, 0, positive), or null if either is not one. */
export function compareTags(a: string, b: string): number | null {
  const ma = RELEASE_TAG.exec(a);
  const mb = RELEASE_TAG.exec(b);
  if (!ma || !mb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d) return d;
  }
  return comparePre(ma[4], mb[4]);
}

/** Pre-release order per semver §11: none ranks above any, numeric ids below alphanumeric. */
function comparePre(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i]!;
    const y = pb[i]!;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

const PINS_REL = posix.join('.github', 'actions', 'engine', 'pins.yml');
const CODEOWNERS_REL = 'CODEOWNERS';

/* --------------------------------------------------------------------------
 * Settings read back from the repo (pins.yml, CODEOWNERS, myst.yml)
 * ------------------------------------------------------------------------ */

/** The owner column of the first gated line in CODEOWNERS, or a default. The whole column: a
 *  path may have more than one owner [R126]. */
export function ownerFromCodeowners(src: string): string {
  const first = Object.values(codeownersColumns(src))[0];
  return first ?? '@owner';
}

/** The repo's owner column per gated path, so an owner added by hand survives a resync
 *  [R126]. Empty without a CODEOWNERS file. */
function codeownersOnDisk(repoRoot: string): Record<string, string> {
  const co = join(repoRoot, CODEOWNERS_REL);
  return existsSync(co) ? codeownersColumns(readFileSync(co, 'utf8')) : {};
}

export function readAnswers(repoRoot: string): TemplateAnswers {
  // A missing pins.yml means no oak pin here; cmdUpgrade reports that in a sentence rather than an
  // ENOENT stack.
  const pinsPath = join(repoRoot, PINS_REL);
  const pins = existsSync(pinsPath) ? readDoc(pinsPath) : null;
  const engineRepo = String(pins?.get('engine_repo') ?? '');
  const instanceRepo = String(pins?.get('instance_repo') ?? '.');
  const coPath = join(repoRoot, CODEOWNERS_REL);
  const owner = existsSync(coPath) ? ownerFromCodeowners(readFileSync(coPath, 'utf8')) : '@owner';
  const myst = join(repoRoot, 'myst.yml');
  let version = '';
  let edition = '';
  if (existsSync(myst)) {
    const doc = readDoc(myst);
    version = String(doc.getIn(['project', 'options', 'oaktree-sapling', 'version']) ?? '');
    edition = String(doc.getIn(['project', 'options', 'oaktree-sapling', 'edition']) ?? '');
  }
  return { engineRepo, instanceRepo, owner, version, edition };
}

/* --------------------------------------------------------------------------
 * Differences: each engine-managed file rendered at the target, compared with the file on disk
 * ------------------------------------------------------------------------ */

/** The engine-managed files: everything under `.github/`, and `CODEOWNERS`. All are gated
 *  (checks.ts `frozenPathsTouched`), but `paper-environment.yml` is gated and the author's, so
 *  like `myst.yml`, `index.md` and `bib.bib` it is never reset. */
function frozenFiles(templateAtTarget: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = prefix ? posix.join(prefix, name) : name;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else if (rel === CODEOWNERS_REL || rel.startsWith('.github/')) out.push(rel);
    }
  };
  walk(templateAtTarget, '');
  return out.sort();
}

/** Renders one engine-managed file at the target with the repo's settings, keeping its own
 *  CODEOWNERS columns ({@link codeownersOnDisk}). */
export function renderFrozenFile(
  templateAtTarget: string,
  rel: string,
  answers: TemplateAnswers,
  owners: Record<string, string> = {},
): string {
  if (rel === PINS_REL) return renderPins(templateAtTarget, answers);
  if (rel === CODEOWNERS_REL)
    return renderCodeowners(
      readFileSync(join(templateAtTarget, rel), 'utf8'),
      answers.owner,
      owners,
    );
  return readFileSync(join(templateAtTarget, rel), 'utf8');
}

/**
 * Files under `.github/` that the target template does not ship [R143]. They are reported,
 * not deleted: they may be the repo's own additions (a `dependabot.yml`), and nothing
 * records which files oak once shipped, so a person decides.
 */
export function extraFrozenFiles(repoRoot: string, templateAtTarget: string): string[] {
  const shipped = new Set(frozenFiles(templateAtTarget));
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = prefix ? posix.join(prefix, name) : name;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else if (!shipped.has(rel)) out.push(rel);
    }
  };
  walk(join(repoRoot, '.github'), '.github');
  return out.sort();
}

/**
 * The engine-managed files whose render at the target differs from the file on disk, or that are
 * missing. Returns their relative paths, sorted.
 */
export function computeDrift(
  repoRoot: string,
  templateAtTarget: string,
  answers: TemplateAnswers,
): string[] {
  const changed: string[] = [];
  const owners = codeownersOnDisk(repoRoot);
  for (const rel of frozenFiles(templateAtTarget)) {
    const rendered = renderFrozenFile(templateAtTarget, rel, answers, owners);
    const onDisk = join(repoRoot, rel);
    if (!existsSync(onDisk) || readFileSync(onDisk, 'utf8') !== rendered) changed.push(rel);
  }
  return changed;
}

/* --------------------------------------------------------------------------
 * Injected, so tests use fakes
 * ------------------------------------------------------------------------ */

/** What `UpgradePr.open` did: opened a pull request, updated the open one on the branch, or
 *  left it as it was because it already had these changes. */
export type PrAction = 'opened' | 'updated' | 'current';

export interface UpgradePr {
  /** Branch, commit as the bot, push, and open the pull request or update the branch's open one. */
  open(
    repoRoot: string,
    opts: { branch: string; title: string; body: string; paths: string[] },
  ): { url: string; action: PrAction };
}

export interface UpgradeDeps {
  /** The latest release tag of `engineRepo`, used when `--to` is absent. */
  resolveTarget(engineRepo: string): string;
  /** Gets `templates/paper/` of `engineRepo` at `tag`; returns its path. */
  materializeTemplate(engineRepo: string, tag: string): string;
  pr: UpgradePr;
  log(msg: string): void;
  confirm(plan: string[]): Promise<boolean>;
}

export type UpgradeMode = 'version-only' | 'files-only' | 'both';

export interface UpgradeInput {
  repoRoot: string;
  to?: string; // target tag; else latest release
  mode: UpgradeMode;
}

export interface Outcome {
  exitCode: number;
  result: Record<string, unknown>;
}

/** Writes the target version into `myst.yml`. */
function bumpVersion(repoRoot: string, target: string): void {
  const myst = join(repoRoot, 'myst.yml');
  const doc = readDoc(myst);
  doc.setIn(['project', 'options', 'oaktree-sapling', 'version'], target);
  writeDoc(myst, doc);
}

/** Overwrites the engine-managed files that differ with their render at the target. */
function resyncFiles(
  repoRoot: string,
  templateAtTarget: string,
  answers: TemplateAnswers,
  drift: string[],
): void {
  const owners = codeownersOnDisk(repoRoot);
  for (const rel of drift) {
    const dest = join(repoRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, renderFrozenFile(templateAtTarget, rel, answers, owners));
  }
}

export async function cmdUpgrade(input: UpgradeInput, deps: UpgradeDeps): Promise<Outcome> {
  const { repoRoot, mode } = input;
  const answers = readAnswers(repoRoot);
  if (!answers.engineRepo) {
    return {
      exitCode: 2,
      result: { status: 'error', message: msg.upgrade.notAPaperRepo(PINS_REL) },
    };
  }
  // A target oak picked is printed, as in bootstrap: `--to v1.2.3` is reproducible, "the newest
  // right now" is not.
  const targetGiven = Boolean(input.to);
  const target = input.to ?? deps.resolveTarget(answers.engineRepo);

  // The newest release never moves a pin back: a pre-release or a ref picked by hand stays.
  if (!targetGiven && answers.version) {
    const order = compareTags(answers.version, target);
    if (order === null || order > 0) {
      deps.log(msg.upgrade.pinAhead(answers.version, target, answers.engineRepo));
      return {
        exitCode: 0,
        result: { status: 'ok', target, pin: answers.version, pr: null, pin_ahead: true },
      };
    }
  }
  const wantVersion = mode === 'version-only' || mode === 'both';
  const wantFiles = mode === 'files-only' || mode === 'both';

  const versionChanged = wantVersion && answers.version !== target;

  // The template is only fetched for a files resync; a version-only bump needs none.
  let drift: string[] = [];
  let extra: string[] = [];
  let templateAtTarget: string | null = null;
  if (wantFiles) {
    templateAtTarget = deps.materializeTemplate(answers.engineRepo, target);
    drift = computeDrift(repoRoot, templateAtTarget, answers);
    extra = extraFrozenFiles(repoRoot, templateAtTarget);
  }
  const filesChanged = wantFiles && drift.length > 0;

  if (!versionChanged && !filesChanged) {
    deps.log(msg.upgrade.upToDate(target, answers.engineRepo, targetGiven));
    // Report files the target no longer ships even when up to date: a retired workflow may
    // still be running [R143].
    if (extra.length) deps.log(msg.upgrade.planExtraFiles(extra));
    return {
      exitCode: 0,
      result: { status: 'ok', target, drift: [], extra, pr: null, up_to_date: true },
    };
  }

  const plan = [
    msg.upgrade.planHeader(repoRoot, target),
    msg.upgrade.planTarget(target, answers.engineRepo, targetGiven),
    ...(versionChanged ? [msg.upgrade.planBumpVersion(answers.version, target)] : []),
    ...(filesChanged ? [msg.upgrade.planResync(drift.length, target, drift.join(', '))] : []),
    ...(wantFiles && !filesChanged ? [msg.upgrade.planFilesMatch(target)] : []),
    ...(extra.length ? [msg.upgrade.planExtraFiles(extra)] : []),
    msg.upgrade.planAsPr,
  ];
  if (!(await deps.confirm(plan)))
    return {
      exitCode: 0,
      result: {
        status: 'aborted',
        target,
        reason: msg.prompt.abortedNoPr,
      },
    };

  const paths: string[] = [];
  if (versionChanged) {
    bumpVersion(repoRoot, target);
    paths.push('myst.yml');
  }
  if (filesChanged) {
    resyncFiles(repoRoot, templateAtTarget!, answers, drift);
    paths.push(...drift);
  }

  const { url, action } = deps.pr.open(repoRoot, {
    branch: targetGiven ? `${UPGRADE_BRANCH}-${target}` : UPGRADE_BRANCH,
    title: msg.upgrade.prTitle(target),
    body: upgradeBody(target, versionChanged, drift, extra),
    paths,
  });
  const logs = {
    opened: msg.upgrade.logPrOpened,
    updated: msg.upgrade.logPrUpdated,
    current: msg.upgrade.logPrCurrent,
  };
  deps.log(logs[action](url));
  return {
    exitCode: 0,
    result: {
      status: 'ok',
      target,
      drift,
      extra,
      version_bumped: versionChanged,
      pr: url,
      pr_action: action,
      paths,
    },
  };
}

function upgradeBody(
  target: string,
  versionChanged: boolean,
  drift: string[],
  extra: string[],
): string {
  const lines = [msg.upgrade.prBodyHeader(target), ''];
  if (versionChanged) lines.push(msg.upgrade.prBodyVersion(target));
  if (drift.length) {
    lines.push(msg.upgrade.prBodyFiles(target));
    for (const d of drift) lines.push(`  - \`${d}\``);
  }
  if (extra.length) {
    lines.push('', msg.upgrade.prBodyExtra(target));
    for (const e of extra) lines.push(`  - \`${e}\``);
  }
  lines.push('', msg.upgrade.prBodyFooter);
  return lines.join('\n');
}
