/**
 * projects.ts: where a repository's papers are, for both tiers. A co-located repository holds
 * one paper per `papers/<id>/` folder; a paper repository holds one paper at its root. The tier
 * is read from the gated `pins.yml` ({@link isColocated}), never from the folders an author can
 * add.
 *
 * A folder name is a paper id, a tag prefix, an artifact name and a preview branch part, and a
 * fork pull request controls it, so every one is checked against {@link PAPER_ID}.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { PAPER_VERSION_TAG } from './schema.js';
import { readDoc } from './yaml-io.js';

/** The folder holding a co-located repository's papers. */
export const PAPERS_DIR = 'papers';

/** A paper folder's name, which is its `project.id`: letters, digits, `_` and `-`, starting with
 *  a letter or digit. No `.` or `/`, so it is one path segment and a valid tag prefix. The engine
 *  action's `ref` step keeps a shell copy, held to this one by `paper id rule parity` in
 *  `test/frozen-guards.test.ts`. */
export const PAPER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** The pins.yml key naming the engine a co-located repository's jobs with no paper of their own
 *  run. */
export const ENGINE_VERSION_KEY = 'engine_version';

const PINS_REL = join('.github', 'actions', 'engine', 'pins.yml');

/** Whether `root` is a co-located repository: its `pins.yml`, which editors gate, names `.` as
 *  the journal repository, since it holds its own journal settings. The engine action's `ref`
 *  step decides the same way. A missing key is a paper repository whose journal is unknown. */
export function isColocated(root: string): boolean {
  const pins = join(root, PINS_REL);
  return existsSync(pins) && readDoc(pins).get('instance_repo') === '.';
}

/**
 * The papers under `root`, as folders relative to it: in a co-located repository `papers/<id>`
 * for every folder there holding a `myst.yml`, sorted, else `.`. Throws a UserError for such a
 * folder not named by a {@link PAPER_ID}: its paper could be neither built nor checked.
 */
export function discoverProjects(root: string): string[] {
  if (!isColocated(root)) return ['.'];
  const dir = join(root, PAPERS_DIR);
  if (!existsSync(dir)) return [];
  const papers = readdirSync(dir)
    .filter(
      (name) => statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, 'myst.yml')),
    )
    .sort();
  const bad = papers.find((name) => !PAPER_ID.test(name));
  if (bad !== undefined)
    throw new UserError(msg.workflow.badPaperFolder(posix.join(PAPERS_DIR, bad)));
  return papers.map((name) => posix.join(PAPERS_DIR, name));
}

/** The id a paper folder is named by: `<id>` for `papers/<id>`, null for `.` or anything else. */
export function folderId(paperDir: string): string | null {
  const m = /^papers\/([^/]+)$/.exec(paperDir);
  return m && PAPER_ID.test(m[1]!) ? m[1]! : null;
}

/** `papers/<id>`, or a UserError naming `source` when `id` is not a {@link PAPER_ID}. */
export function paperDirOf(id: string, source: string): string {
  if (!PAPER_ID.test(id)) throw new UserError(msg.workflow.badPaperId(source, id));
  return posix.join(PAPERS_DIR, id);
}

/** The nearest directory from `dir` up that holds `.git`, or undefined outside a repository. */
export function findRepoRoot(dir: string): string | undefined {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return undefined;
  }
}

/** `paperRoot` relative to `repoRoot`, posix, `.` for the root itself. */
export function paperDirIn(repoRoot: string, paperRoot: string): string {
  return relative(resolve(repoRoot), resolve(paperRoot)).split(sep).join('/') || '.';
}

/**
 * The co-located paper folder `paperRoot` is, as `papers/<id>` with the id it is named by, or
 * null for a paper at a repository root. Decided by the folder's place in its repository, so it
 * also works on a checkout with no git (the parent is a `papers` folder).
 */
export function colocatedPaper(paperRoot: string): { dir: string; id: string } | null {
  const abs = resolve(paperRoot);
  if (basename(dirname(abs)) !== PAPERS_DIR) return null;
  const id = basename(abs);
  return { dir: posix.join(PAPERS_DIR, id), id };
}

/** A version tag: `vX.Y.Z` for the paper at a repository root, `<id>/vX.Y.Z` for
 *  `papers/<id>`. */
export interface PaperTag {
  /** `.` or `papers/<id>`. */
  paperDir: string;
  id: string | null;
  /** The `vX.Y.Z` part, which the deposit's version is read from. */
  version: string;
}

/** Reads a version tag ({@link PaperTag}), or returns null for anything else. */
export function parsePaperTag(tag: string): PaperTag | null {
  if (PAPER_VERSION_TAG.test(tag)) return { paperDir: '.', id: null, version: tag };
  const slash = tag.indexOf('/');
  if (slash < 0) return null;
  const id = tag.slice(0, slash);
  const version = tag.slice(slash + 1);
  if (!PAPER_ID.test(id) || !PAPER_VERSION_TAG.test(version)) return null;
  return { paperDir: posix.join(PAPERS_DIR, id), id, version };
}

/** The outcome of {@link forkPaper}: the one paper a fork pull request changes, or why it is
 *  refused. */
export type ForkChange = { paper: string } | { refused: string };

/**
 * The one-paper rule for a fork's pull request in a co-located repository: every changed file is
 * in one `papers/<id>/` folder. `changed` is GitHub's list of changed files, null when it could
 * not be listed in full, which is refused.
 */
export function forkPaper(changed: string[] | null): ForkChange {
  if (changed === null) return { refused: msg.pr.forkUnlisted };
  const outside = changed.filter((f) => folderOfFile(f) === null);
  if (outside.length) return { refused: msg.pr.forkOutsidePapers(outside) };
  const papers = [...new Set(changed.map((f) => folderOfFile(f)!))].sort();
  if (papers.length === 0) return { refused: msg.pr.forkNoPaper };
  if (papers.length > 1) return { refused: msg.pr.forkSeveralPapers(papers) };
  return { paper: papers[0]! };
}

/** `papers/<id>` for a file inside a paper folder, else null. */
function folderOfFile(file: string): string | null {
  const m = /^papers\/([^/]+)\/./.exec(file);
  return m && PAPER_ID.test(m[1]!) ? posix.join(PAPERS_DIR, m[1]!) : null;
}
