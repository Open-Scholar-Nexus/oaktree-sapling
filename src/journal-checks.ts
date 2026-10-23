/**
 * journal-checks.ts: the journal's own check files, named in `journal.yml` `checks:` by a `./`
 * path into the journal repository [R208].
 *
 * A check file loads from the journal clone, where myst-cli is not installed [R51], so it gets
 * {@link Paper}: plain data and two helpers.
 */
import { statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { GenericNode, GenericParent } from 'myst-common';
import * as messages from './messages.js';
import { UserError, firstLine } from './messages.js';

/** One page of the paper, as MyST processed it. */
export interface PaperPage {
  /** Absolute path. */
  file: string;
  frontmatter: Record<string, any>;
  mdast: GenericParent;
}

/** What a check file's `validate` gets. Fields are only ever added [R208]. */
export interface Paper {
  /** The paper folder, absolute. */
  root: string;
  /** The project frontmatter as MyST resolved it. */
  project: Record<string, any>;
  /** One per page in the table of contents, `index.md` first. */
  pages: PaperPage[];
  toText(node: GenericNode | GenericNode[]): string;
  selectAll(selector: string, node: GenericNode): GenericNode[];
}

/** Whether a `checks:` id names a check file: it starts with `./` or `../`, the prefix rule of
 *  `typst_template` [R76]. Any other id is a catalog id. */
export function isCheckFile(id: string): boolean {
  return /^\.\.?\//.test(id);
}

/**
 * The absolute path of a check file. Throws a {@link UserError} when the path leaves the journal
 * repository, does not end in `.mjs`, or names no file [R208].
 */
export function resolveCheckFile(journalRoot: string | null, id: string): string {
  if (!journalRoot) throw new UserError(messages.pr.checkFileMissing(id));
  const abs = resolve(journalRoot, id);
  const rel = relative(journalRoot, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new UserError(messages.pr.checkFileOutside);
  }
  // Node reads a `.js` file as CommonJS or ESM depending on a package.json the journal may lack.
  if (extname(abs) !== '.mjs') throw new UserError(messages.pr.checkFileNotMjs);
  if (!statSync(abs, { throwIfNoEntry: false })?.isFile()) {
    throw new UserError(messages.pr.checkFileMissing(abs));
  }
  return abs;
}

export type ModuleImporter = (url: string) => Promise<unknown>;

interface CheckFileModule {
  validate(paper: Paper, options: Record<string, unknown>): unknown;
}

/** Loads check files by id, each file once however many entries name it. The promise rejects
 *  with a {@link UserError} for a bad path, a failed import or a missing `validate`. */
export function checkFileLoader(
  journalRoot: string | null,
  importer: ModuleImporter = (url) => import(url),
): (id: string) => Promise<CheckFileModule> {
  const loaded = new Map<string, Promise<CheckFileModule>>();
  return async (id) => {
    const abs = resolveCheckFile(journalRoot, id);
    let mod = loaded.get(abs);
    if (!mod) {
      mod = importCheckFile(abs, importer);
      loaded.set(abs, mod);
    }
    return mod;
  };
}

async function importCheckFile(abs: string, importer: ModuleImporter): Promise<CheckFileModule> {
  let mod: unknown;
  try {
    mod = await importer(pathToFileURL(abs).href);
  } catch (e) {
    throw new UserError(messages.pr.checkFileImportFailed(firstLine(e)));
  }
  const check = (mod as { default?: unknown } | null)?.default;
  if (typeof (check as { validate?: unknown } | null)?.validate !== 'function') {
    throw new UserError(messages.pr.checkFileNoValidate);
  }
  return check as CheckFileModule;
}

/** A unist point, as on every MyST node's `position`. */
const Point = z.object({ line: z.number(), column: z.number(), offset: z.number().optional() });

/** The result shape a check file returns, Curvenote's `CheckResult` without its extras. */
const CheckFileResult = z.object({
  status: z.enum(['pass', 'fail', 'error']),
  message: z.string(),
  help: z.string().optional(),
  file: z.string().optional(),
  // `toCheckRun` reads the lines for an inline annotation.
  position: z.object({ start: Point, end: Point }).optional(),
  optional: z.boolean().optional(),
});
export type CheckFileResult = z.infer<typeof CheckFileResult>;

/**
 * Runs one check file's `validate` on its own copy of `paper`'s data, so a check that edits a
 * tree leaves the next one unaffected. Returns the results; an empty list adds no row. Throws a
 * {@link UserError} when loading fails, `validate` throws or rejects, or a result has the wrong
 * shape.
 */
export async function runCheckFile(
  load: (id: string) => Promise<CheckFileModule>,
  id: string,
  options: Record<string, unknown>,
  paper: Paper,
): Promise<CheckFileResult[]> {
  const check = await load(id);
  const own: Paper = {
    ...paper,
    project: structuredClone(paper.project),
    pages: structuredClone(paper.pages),
  };
  let res: unknown;
  try {
    res = await check.validate(own, options);
  } catch (e) {
    throw new UserError(messages.pr.checkFileThrew(firstLine(e)));
  }
  const list = Array.isArray(res) ? res : [res];
  return list.map((r, i) => {
    const parsed = CheckFileResult.safeParse(r);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    const where = [...(Array.isArray(res) ? [i] : []), ...(issue?.path ?? [])].join('.');
    throw new UserError(messages.pr.checkFileBadResult(where, issue?.message ?? 'invalid'));
  });
}
