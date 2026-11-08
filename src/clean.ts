/**
 * clean.ts: `oak clean`, which lists and removes the clones `oak release` keeps after a failure,
 * and the pinned oak versions in `~/.cache/oak` with `--cache`. Documented at DOCS.clean.
 */
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as msg from './messages.js';
import { ok, type Outcome } from './result.js';

/** The name every folder `oak release` makes in the temporary folder starts with. */
export const CLONE_PREFIX = 'oak-release-';
/** How many characters `mkdtemp` appends to a prefix. */
const MKDTEMP_SUFFIX = 6;

/**
 * The start of the name of the folder `oak release` clones `repo` into for `tag`. GitHub owner
 * names and version tags hold no `_`, so each repo and tag has its own prefix.
 */
export function clonePrefix(repo: string, tag: string): string {
  return `${CLONE_PREFIX}${repo.replace('/', '_')}_${tag}-`;
}

/** The bytes under `path`, counting a symlink as itself and never following one. */
export function sizeOf(path: string): number {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  let names: string[];
  try {
    names = readdirSync(path);
  } catch {
    // A folder it cannot read counts as itself.
    return st.size;
  }
  let total = st.size;
  for (const name of names) total += sizeOf(join(path, name));
  return total;
}

/** The folders in `dir` named {@link CLONE_PREFIX} and owned by `uid` (by anyone when undefined,
 *  as on Windows); a symlink never counts. */
export function findKeptClones(dir: string, uid: number | undefined): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(CLONE_PREFIX))
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        const st = lstatSync(path);
        return st.isDirectory() && (uid === undefined || st.uid === uid);
      } catch {
        return false;
      }
    });
}

/** Removes the clones in `dir` kept for `repo` and `tag` ({@link clonePrefix}), and returns
 *  their paths. */
export function removeKeptClones(
  dir: string,
  repo: string,
  tag: string,
  uid: number | undefined,
): string[] {
  const prefix = clonePrefix(repo, tag);
  const done = findKeptClones(dir, uid).filter((path) => {
    const name = basename(path);
    return name.startsWith(prefix) && name.length === prefix.length + MKDTEMP_SUFFIX;
  });
  for (const path of done) rmSync(path, { recursive: true, force: true });
  return done;
}

export interface CleanInput {
  /** The temporary folder `oak release` clones into. */
  dir: string;
  /** `~/.cache/oak`, which holds the pinned oak versions. */
  cacheDir: string;
  /** `--cache`: remove {@link CleanInput.cacheDir} too. */
  cache: boolean;
}

/** `oak clean`: prints the kept clones and the cache as its plan, asks, and removes them. */
export async function cmdClean(
  input: CleanInput,
  deps: {
    uid: number | undefined;
    confirm(plan: string[]): Promise<boolean>;
    log(line: string): void;
  },
): Promise<Outcome> {
  const clones = findKeptClones(input.dir, deps.uid).map((path) => ({ path, bytes: sizeOf(path) }));
  const cacheBytes = existsSync(input.cacheDir) ? sizeOf(input.cacheDir) : 0;
  const cache = input.cache && cacheBytes > 0;
  const summary = {
    dir: input.dir,
    clones,
    cache: { path: input.cacheDir, bytes: cacheBytes },
    removed: false,
  };

  if (!clones.length) deps.log(msg.clean.noClones(input.dir));
  if (!input.cache && cacheBytes > 0) deps.log(msg.clean.cacheKept(input.cacheDir, cacheBytes));
  if (!clones.length && !cache) return ok(summary);

  const plan = [
    msg.clean.planHeader,
    ...clones.map((c) => msg.clean.planClone(c.path, c.bytes)),
    ...(cache ? [msg.clean.planCache(input.cacheDir, cacheBytes)] : []),
  ];
  if (!(await deps.confirm(plan))) return ok(summary);

  for (const c of clones) rmSync(c.path, { recursive: true, force: true });
  if (cache) rmSync(input.cacheDir, { recursive: true, force: true });
  const bytes = clones.reduce((n, c) => n + c.bytes, 0) + (cache ? cacheBytes : 0);
  deps.log(msg.clean.done(clones.length, cache, bytes));
  return ok({ ...summary, removed: true });
}
