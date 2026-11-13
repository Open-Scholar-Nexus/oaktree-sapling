/**
 * pinned.ts: hands `oak build`, `validate`, `start` and the `release` subcommands to the oak
 * version the paper pins, and `oak bootstrap` to the one `--engine-version` names. `oak release`
 * with a version hands over only its subcommands (`cmdReleaseVersion` in cli.ts).
 *
 * The paper's `myst.yml` names the version and its `pins.yml` the repository, as in CI, so a
 * local run builds with the same oak. Side effects are injected so the tests stay offline.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { readDoc, readEngineCoordinateRaw } from './yaml-io.js';
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { compareEngineVersions, ENGINE_VERSION, GITHUB_REPO } from './schema.js';

export type PaperVerb = 'build' | 'validate' | 'start' | 'release';
export type HandoffVerb = PaperVerb | 'bootstrap';

/** Where the version came from: the paper's files, or `--engine-version` and `--engine-repo`. */
export type PinSource = { kind: 'paper'; mystPath: string; pinsPath?: string } | { kind: 'flag' };

/** Set on the handed-off oak so it never hands off again, and by CI, the tests and engine
 *  development to run this oak. */
export const USE_RUNNING_ENV = 'OAK_USE_RUNNING';

const PINS_FILE = join('.github', 'actions', 'engine', 'pins.yml');

export interface PinnedEngine {
  engineRepo: string;
  version: string;
}

/** The nearest `pins.yml` from `paperRoot` up to the repo root, so a paper below the root
 *  (co-located) reads the repo's. Outside a git repo, only `paperRoot`'s own. */
function findPins(paperRoot: string): string | undefined {
  const start = resolve(paperRoot);
  const top = repoRoot(start) ?? start;
  for (let dir = start; ; dir = dirname(dir)) {
    const pins = join(dir, PINS_FILE);
    if (existsSync(pins)) return pins;
    if (dir === top) return undefined;
  }
}

/** The nearest directory from `dir` up that holds `.git`. */
function repoRoot(dir: string): string | undefined {
  for (; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The version `<paperRoot>/myst.yml` pins and `engine_repo` from the repo's `pins.yml` (else
 *  `defaultRepo`), or undefined when there is no readable pin: the verb then reports it. */
export function readPin(
  paperRoot: string,
  defaultRepo: string,
): (PinnedEngine & { pinsPath?: string }) | undefined {
  let version: string;
  try {
    version = readEngineCoordinateRaw(readDoc(join(paperRoot, 'myst.yml'))).version;
  } catch {
    return undefined;
  }
  const { value, pinsPath } = readPinsValue(paperRoot, 'engine_repo');
  return { engineRepo: value ?? defaultRepo, version, pinsPath };
}

/** A string from the repo's `pins.yml` ({@link findPins}) and the file's path. `value` is
 *  undefined when the file or the key is absent. */
export function readPinsValue(
  paperRoot: string,
  key: 'engine_repo' | 'instance_repo',
): { value?: string; pinsPath?: string } {
  const pinsPath = findPins(paperRoot);
  const v = pinsPath ? readDoc(pinsPath).get(key) : undefined;
  return { value: typeof v === 'string' && v ? v : undefined, pinsPath };
}

/** `$XDG_CACHE_HOME`, or `~/.cache` when it is unset or relative (XDG requires absolute). */
export function cacheHome(env: NodeJS.ProcessEnv, home: string): string {
  const xdg = env.XDG_CACHE_HOME;
  return xdg && isAbsolute(xdg) ? xdg : join(home, '.cache');
}

export interface HandoffDeps {
  /** Shallow-clones `engineRepo` at `tag` into the empty directory `dest`; throws on failure. */
  clone(engineRepo: string, tag: string, dest: string): void;
  /** Whether `<binDir>/typst --version` runs on this machine. */
  typstRuns(binDir: string): boolean;
  /** Runs `node <cli> ...argv` and returns its exit code. */
  spawn(cli: string, argv: string[], env: NodeJS.ProcessEnv): number | Promise<number>;
  /** Asks before fetching oak from an engine repository other than oak's own. It asks even with
   *  `--yes`, so someone at a terminal has to type yes. */
  confirm(plan: string[]): Promise<boolean>;
  log(line: string): void;
  /** Prints which version runs; {@link HandoffDeps.log} when unset. */
  logRunning?(line: string): void;
}

export interface HandoffContext {
  verb: HandoffVerb;
  /** The verb's arguments, passed on unchanged. */
  argv: string[];
  /** This oak's version as a tag, `v` + OAK_VERSION. */
  running: string;
  defaultRepo: string;
  env: NodeJS.ProcessEnv;
  /** `<cacheRoot>/oak/<owner>/<name>/<tag>` holds each fetched version. */
  cacheRoot: string;
  /** Whether this oak runs from a git checkout, which `engine.zip` is archived from. */
  runningIsCheckout: boolean;
}

/** The verbs that hold the Zenodo token: the `release` steps. They archive oak's checkout into
 *  the deposit, so they never run from the npm package, which has no git history. */
const DEPOSIT_VERBS: HandoffVerb[] = ['release'];

/** The first oak whose `oak release` steps never build beside the Zenodo token, and the
 *  `min_engine_version` in templates/paper/.github/actions/engine/pins.yml. The pin is in the
 *  author's `myst.yml`, so {@link DEPOSIT_VERBS} refuse a pin below this one. */
export const DEPOSIT_MIN_VERSION = 'v0.4.0-dev.6';

/** Throws a {@link UserError} when `version` is below {@link DEPOSIT_MIN_VERSION}, or is no
 *  version at all. */
export function assertDepositPin(verb: HandoffVerb, version: string): void {
  if ((compareEngineVersions(version, DEPOSIT_MIN_VERSION) ?? -1) < 0) {
    throw new UserError(msg.pinned.belowDepositMin(verb, version, DEPOSIT_MIN_VERSION));
  }
}

/**
 * Runs the verb with the oak the paper pins and returns its exit code, or null when this oak
 * runs it: same version, no readable pin, or {@link USE_RUNNING_ENV} set.
 * Throws a {@link UserError} for a malformed pin, a failed fetch, or a ref with no build.
 */
export async function handOff(
  ctx: HandoffContext & { paperRoot: string },
  deps: HandoffDeps,
): Promise<number | null> {
  if (usesRunning(ctx)) return null;
  const pin = readPin(ctx.paperRoot, ctx.defaultRepo);
  if (!pin) return null;
  const mystPath = join(ctx.paperRoot, 'myst.yml');
  return runVersion(pin, { kind: 'paper', mystPath, pinsPath: pin.pinsPath }, ctx, deps);
}

/**
 * Runs the verb with oak `pin.version` from `pin.engineRepo`, fetched once into the cache, and
 * returns its exit code, or null when this oak is that version or {@link handOff}'s opt-outs
 * apply. Throws as {@link handOff} does.
 */
export async function runVersion(
  pin: PinnedEngine,
  source: PinSource,
  ctx: HandoffContext,
  deps: HandoffDeps,
): Promise<number | null> {
  const { verb } = ctx;
  if (usesRunning(ctx)) return null;
  if (pin.version === ctx.running && (ctx.runningIsCheckout || !DEPOSIT_VERBS.includes(verb))) {
    return null;
  }

  // Both reach `git clone` and the cache path, so they are checked before either.
  if (!ENGINE_VERSION.test(pin.version)) {
    const where = source.kind === 'paper' ? source.mystPath : '--engine-version';
    throw new UserError(msg.pinned.badVersion(verb, pin.version, where));
  }
  if (DEPOSIT_VERBS.includes(verb)) assertDepositPin(verb, pin.version);
  if (!GITHUB_REPO.test(pin.engineRepo)) {
    throw new UserError(msg.pinned.badRepo(verb, pin.engineRepo, source));
  }

  const dir = join(ctx.cacheRoot, 'oak', ...pin.engineRepo.split('/'), pin.version);
  if (!existsSync(dir)) {
    // Another repository's code runs only once the user confirms it.
    if (
      pin.engineRepo !== ctx.defaultRepo &&
      !(await deps.confirm([msg.pinned.otherRepo(verb, pin, source, ctx.defaultRepo)]))
    ) {
      return 2;
    }
    deps.log(msg.pinned.downloading(verb, pin, dir));
    fetchInto(dir, pin, source, verb, deps);
  }
  const cli = join(dir, 'dist', 'cli.cjs');
  if (!existsSync(cli)) throw new UserError(msg.pinned.noBuild(verb, pin, source, dir));

  const running = msg.pinned.running(verb, pin, source, dir, ctx.running);
  if (deps.logRunning) deps.logRunning(running);
  else deps.log(`${running}\n`);
  const env: NodeJS.ProcessEnv = { ...ctx.env, [USE_RUNNING_ENV]: '1' };
  // The release's typst is built for linux x86_64 only; `ci/run.sh` makes the same check.
  const bin = join(dir, 'bin');
  if (deps.typstRuns(bin)) env.PATH = env.PATH ? bin + delimiter + env.PATH : bin;
  return deps.spawn(cli, [verb, ...ctx.argv], env);
}

function usesRunning(ctx: HandoffContext): boolean {
  return !!ctx.env[USE_RUNNING_ENV];
}

/** Clones beside `dir` and renames it in, so only a complete clone sits at `dir`. */
function fetchInto(
  dir: string,
  pin: PinnedEngine,
  source: PinSource,
  verb: HandoffVerb,
  deps: HandoffDeps,
): void {
  mkdirSync(dirname(dir), { recursive: true });
  const tmp = mkdtempSync(join(dirname(dir), `.${pin.version}-`));
  try {
    deps.clone(pin.engineRepo, pin.version, tmp);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    const why = err instanceof Error ? err.message : String(err);
    throw new UserError(msg.pinned.fetchFailed(verb, pin, source, why));
  }
  try {
    renameSync(tmp, dir);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    // Another oak finished the same clone first.
    if (!existsSync(dir)) throw err;
  }
}
