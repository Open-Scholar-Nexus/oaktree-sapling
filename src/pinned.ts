/**
 * pinned.ts: hands `oak build`, `validate` and `start` to the oak version the paper pins.
 *
 * The paper's `myst.yml` names the version and its `pins.yml` the repository, as in CI, so a
 * local run builds with the same oak. Side effects are injected so the tests stay offline.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { readDoc, readEngineCoordinateRaw } from './yaml-io.js';
import * as msg from './messages.js';
import { UserError } from './messages.js';

export type PaperVerb = 'build' | 'validate' | 'start';

/** Set on the handed-off oak so it never hands off again; also an opt-out for engine
 *  development, like `--use-running`. */
export const USE_RUNNING_ENV = 'OAK_USE_RUNNING';

/** GitHub's owner and repository characters; a name cannot start with `.`, which also rules
 *  out `..` in the cache path. */
const ENGINE_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const ENGINE_VERSION = /^v[0-9]+\.[0-9]+\.[0-9]+(-dev\.[0-9]+)?$/;

const PINS_FILE = join('.github', 'actions', 'engine', 'pins.yml');

export interface PinnedEngine {
  engineRepo: string;
  version: string;
}

/** The nearest `pins.yml` from `paperRoot` up to the repo root, so a paper below the root
 *  (co-located) reads the repo's. */
function findPins(paperRoot: string): string | undefined {
  for (let dir = resolve(paperRoot); ; dir = dirname(dir)) {
    const pins = join(dir, PINS_FILE);
    if (existsSync(pins)) return pins;
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) return undefined;
  }
}

/** The version `<paperRoot>/myst.yml` pins and `engine_repo` from the repo's `pins.yml` (else
 *  `defaultRepo`), or undefined when there is no readable pin: the verb then reports it. */
export function readPin(paperRoot: string, defaultRepo: string): PinnedEngine | undefined {
  let version: string;
  try {
    version = readEngineCoordinateRaw(readDoc(join(paperRoot, 'myst.yml'))).version;
  } catch {
    return undefined;
  }
  const pins = findPins(paperRoot);
  const v = pins ? readDoc(pins).get('engine_repo') : undefined;
  return { engineRepo: typeof v === 'string' && v ? v : defaultRepo, version };
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
  /** Runs `node <cli> ...argv` with stdio inherited and returns its exit code. */
  spawn(cli: string, argv: string[], env: NodeJS.ProcessEnv): number;
  /** Prints the plan and asks; `--yes` accepts it. */
  confirm(plan: string[]): Promise<boolean>;
  log(line: string): void;
}

export interface HandoffContext {
  verb: PaperVerb;
  /** The verb's arguments, passed on unchanged. */
  argv: string[];
  paperRoot: string;
  /** This oak's version as a tag, `v` + OAK_VERSION. */
  running: string;
  defaultRepo: string;
  env: NodeJS.ProcessEnv;
  /** `<cacheRoot>/oak/<owner>/<name>/<tag>` holds each fetched version. */
  cacheRoot: string;
}

/**
 * Runs the verb with the oak the paper pins and returns its exit code, or null when this oak
 * runs it: same version, no readable pin, `--use-running`, or {@link USE_RUNNING_ENV} set.
 * Throws a {@link UserError} for a malformed pin, a failed fetch, or a ref with no build.
 */
export async function handOff(ctx: HandoffContext, deps: HandoffDeps): Promise<number | null> {
  const { verb, paperRoot } = ctx;
  if (ctx.argv.includes('--use-running') || ctx.env[USE_RUNNING_ENV]) return null;
  const pin = readPin(paperRoot, ctx.defaultRepo);
  if (!pin || pin.version === ctx.running) return null;

  // Both reach `git clone` and the cache path, so they are checked before either.
  if (!ENGINE_VERSION.test(pin.version)) {
    throw new UserError(
      msg.pinned.badVersion(verb, pin.version, join(paperRoot, 'myst.yml'), ctx.running),
    );
  }
  if (!ENGINE_REPO.test(pin.engineRepo)) {
    throw new UserError(msg.pinned.badRepo(verb, pin.engineRepo, join(paperRoot, PINS_FILE)));
  }

  const dir = join(ctx.cacheRoot, 'oak', ...pin.engineRepo.split('/'), pin.version);
  if (!existsSync(dir)) {
    // Another repository's code runs only once the user confirms it.
    if (
      pin.engineRepo !== ctx.defaultRepo &&
      !(await deps.confirm([msg.pinned.otherRepo(verb, pin, ctx.defaultRepo)]))
    ) {
      return 2;
    }
    deps.log(msg.pinned.downloading(verb, pin, dir));
    fetchInto(dir, pin, verb, deps);
  }
  const cli = join(dir, 'dist', 'cli.cjs');
  if (!existsSync(cli)) throw new UserError(msg.pinned.noBuild(verb, pin, dir));

  deps.log(msg.pinned.running(verb, pin, dir, ctx.running));
  const env: NodeJS.ProcessEnv = { ...ctx.env, [USE_RUNNING_ENV]: '1' };
  // As ci/run.sh: the release's typst is built for linux x86_64 only.
  const bin = join(dir, 'bin');
  if (deps.typstRuns(bin)) env.PATH = env.PATH ? bin + delimiter + env.PATH : bin;
  return deps.spawn(cli, [verb, ...ctx.argv], env);
}

/** Clones beside `dir` and renames it in, so only a complete clone sits at `dir`. */
function fetchInto(dir: string, pin: PinnedEngine, verb: PaperVerb, deps: HandoffDeps): void {
  mkdirSync(dirname(dir), { recursive: true });
  const tmp = mkdtempSync(join(dirname(dir), `.${pin.version}-`));
  try {
    deps.clone(pin.engineRepo, pin.version, tmp);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    const why = err instanceof Error ? err.message : String(err);
    throw new UserError(msg.pinned.fetchFailed(verb, pin, why));
  }
  try {
    renameSync(tmp, dir);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    // Another oak finished the same clone first.
    if (!existsSync(dir)) throw err;
  }
}
