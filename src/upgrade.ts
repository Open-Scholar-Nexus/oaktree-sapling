/**
 * `oak upgrade`: renders a paper's engine-managed files at a target version from the repo's own
 * settings (`pins.yml`, `CODEOWNERS`), compares them with the files on disk, and opens a pull
 * request that sets the target in `myst.yml` and overwrites the files that differ, which needs a
 * CODEOWNERS review. `--files-only` leaves the version in `myst.yml` as it is. Engine-managed
 * files are never edited by hand, so any difference is reset to the template; a deliberate edit
 * still shows in the pull request. Nothing records a template version.
 *
 * In a co-located repository the version is each paper's `papers/<id>/myst.yml` and pins.yml's
 * `engine_version`, which move together.
 *
 * A repo that is up to date gets no pull request. Without `--to`, the target is the newest stable
 * release, and a pin already past it stays. Each target gets a branch of its own, and running
 * again updates its open pull request. Finding the target, getting the template and opening the
 * pull request are injected, so tests use fakes.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { readDoc, writeDoc } from './yaml-io.js';
import {
  renderPins,
  renderCodeowners,
  codeownersColumns,
  ENGINE_VERSION_KEY,
  type TemplateAnswers,
} from './bootstrap.js';
import { discoverProjects, isColocated } from './projects.js';
import * as msg from './messages.js';
import { err, type Outcome } from './result.js';
import {
  compareEngineVersions,
  ENGINE_MANAGED_PATHS,
  ENGINE_VERSION,
  underPaths,
} from './schema.js';
import type { cmdConformanceReset } from './conformance.js';

/** The branch prefix; the target tag follows it. Exported for {@link cmdConformanceReset},
 *  which deletes these branches [R117]. */
export const UPGRADE_BRANCH_PREFIX = 'oak/upgrade-';

const PINS_REL = posix.join('.github', 'actions', 'engine', 'pins.yml');

/** The pins.yml key naming the oldest engine the workflows beside it run with. */
export const MIN_ENGINE_KEY = 'min_engine_version';

/** `min_engine_version` from the pins.yml under `root` (a repo or a template), or null when the
 *  file or the key is absent. */
export function readMinEngine(root: string): string | null {
  const pins = join(root, PINS_REL);
  if (!existsSync(pins)) return null;
  const v = readDoc(pins).get(MIN_ENGINE_KEY);
  return typeof v === 'string' && v ? v : null;
}
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
  const repoEngineVersion = pins?.get(ENGINE_VERSION_KEY);
  return {
    engineRepo,
    instanceRepo,
    owner,
    version,
    edition,
    ...(typeof repoEngineVersion === 'string' ? { repoEngineVersion } : {}),
  };
}

/** One engine pin: the file it is in, relative to the repo, and the version it names. */
interface EnginePin {
  file: string;
  version: string;
}

/** Every engine pin in the repo: its `myst.yml`, or in a co-located repository each paper's and
 *  pins.yml's `engine_version`. */
function enginePins(repoRoot: string, answers: TemplateAnswers): EnginePin[] {
  if (!isColocated(repoRoot)) return [{ file: 'myst.yml', version: answers.version }];
  const papers = discoverProjects(repoRoot).map((dir) => {
    const file = posix.join(dir, 'myst.yml');
    const v = readDoc(join(repoRoot, file)).getIn([
      'project',
      'options',
      'oaktree-sapling',
      'version',
    ]);
    return { file, version: typeof v === 'string' ? v : '' };
  });
  return [...papers, { file: PINS_REL, version: answers.repoEngineVersion ?? '' }];
}

/* --------------------------------------------------------------------------
 * Differences: each engine-managed file rendered at the target, compared with the file on disk
 * ------------------------------------------------------------------------ */

/** The template's files under {@link ENGINE_MANAGED_PATHS}. `paper-environment.yml` is gated
 *  but the author's, so like `myst.yml`, `index.md` and `bib.bib` it is never reset. */
function frozenFiles(templateAtTarget: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = prefix ? posix.join(prefix, name) : name;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else if (underPaths(ENGINE_MANAGED_PATHS, rel)) out.push(rel);
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

export interface UpgradeInput {
  repoRoot: string;
  to?: string; // target tag; else latest release
  filesOnly?: boolean; // leave the version in myst.yml as it is
}

/** Writes the target version into the `myst.yml` at `file`. */
function bumpVersion(repoRoot: string, target: string, file: string): void {
  const myst = join(repoRoot, file);
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
  const { repoRoot, filesOnly = false } = input;
  const answers = readAnswers(repoRoot);
  if (!answers.engineRepo) {
    return err(2, msg.upgrade.notAPaperRepo(PINS_REL));
  }
  // A target oak picked is printed, as in bootstrap: `--to v1.2.3` is reproducible, "the newest
  // right now" is not.
  const targetGiven = Boolean(input.to);
  const target = input.to ?? deps.resolveTarget(answers.engineRepo);
  // The target becomes a clone ref, a branch name and the pin, and the engine action refuses any
  // pin that is not an engine version.
  if (!ENGINE_VERSION.test(target)) {
    return err(2, msg.upgrade.badTarget(target, answers.engineRepo, targetGiven));
  }
  const pins = enginePins(repoRoot, answers);
  const badPin = filesOnly ? pins.find((p) => !ENGINE_VERSION.test(p.version)) : undefined;
  if (badPin) return err(2, msg.upgrade.badPin(badPin.version, badPin.file));
  // In a co-located repository the repository's own engine stands for the pins it moves with.
  const current = pins.at(-1)!.version;

  // The newest release never moves a pin back from a newer one. A pin that is not an engine
  // version runs nowhere, so it moves.
  if (!targetGiven && (compareEngineVersions(current, target) ?? 0) > 0) {
    deps.log(msg.upgrade.pinAhead(current, target, answers.engineRepo));
    return {
      exitCode: 0,
      result: { status: 'ok', target, pin: current, pr: null, pin_ahead: true },
    };
  }
  const bumped = filesOnly ? [] : pins.filter((p) => p.version !== target);
  const versionChanged = bumped.length > 0;

  const templateAtTarget = deps.materializeTemplate(answers.engineRepo, target);
  const rendered: TemplateAnswers =
    answers.repoEngineVersion !== undefined && !filesOnly
      ? { ...answers, repoEngineVersion: target }
      : answers;
  const drift = computeDrift(repoRoot, templateAtTarget, rendered);
  const extra = extraFrozenFiles(repoRoot, templateAtTarget);
  const filesChanged = drift.length > 0;

  // The pins and the workflows this run leaves must agree: workflows above a pin call verbs it
  // lacks, and on GitHub that fails quietly. In a co-located repository every paper is checked.
  const minEngine = readMinEngine(templateAtTarget);
  if (minEngine) {
    for (const pin of pins) {
      const pinAfter = filesOnly ? pin.version : target;
      const order = compareEngineVersions(pinAfter, minEngine);
      const why =
        order === null
          ? msg.upgrade.badMinimum(minEngine, target)
          : order < 0
            ? msg.upgrade.belowMinimum(pinAfter, minEngine, filesOnly, pin.file)
            : null;
      if (why) return err(2, why, { target, pin: pinAfter, min_engine_version: minEngine });
    }
  }

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
    ...bumped.map((p) => msg.upgrade.planBumpVersion(p.version, target, p.file)),
    filesChanged
      ? msg.upgrade.planResync(drift.length, target, drift.join(', '))
      : msg.upgrade.planFilesMatch(target),
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
  // pins.yml's engine_version moves with the resync of pins.yml.
  for (const p of bumped.filter((b) => b.file !== PINS_REL)) {
    bumpVersion(repoRoot, target, p.file);
    paths.push(p.file);
  }
  if (filesChanged) {
    resyncFiles(repoRoot, templateAtTarget, rendered, drift);
    paths.push(...drift);
  }

  const { url, action } = deps.pr.open(repoRoot, {
    branch: `${UPGRADE_BRANCH_PREFIX}${target}`,
    title: msg.upgrade.prTitle(target),
    body: upgradeBody(
      target,
      bumped.map((b) => b.file),
      drift,
      extra,
    ),
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

function upgradeBody(target: string, bumped: string[], drift: string[], extra: string[]): string {
  const lines = [msg.upgrade.prBodyHeader(target), ''];
  if (bumped.length) lines.push(msg.upgrade.prBodyVersion(target, bumped));
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
