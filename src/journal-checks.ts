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
import { CheckStatus, type CheckResult } from '@curvenote/check-definitions';
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

/** A unist point, as on every MyST node's `position`. */
const Point = z.object({ line: z.number(), column: z.number(), offset: z.number().optional() });

/** The fields of Curvenote's `CheckResult` that oak reports. */
const CheckFileResult = z.object({
  status: z.enum(CheckStatus),
  message: z.string(),
  help: z.string().optional(),
  file: z.string().optional(),
  // `toCheckRun` reads the lines for an inline annotation.
  position: z.object({ start: Point, end: Point }).optional(),
  optional: z.boolean().optional(),
});

/**
 * Imports the check file `id` names and runs its `validate` on a copy of `paper`'s data, so a
 * check that edits a tree leaves the next one unaffected. Returns the results; an empty list adds
 * no row. Throws a {@link UserError} when the file does not load or has no `validate`, when
 * `validate` throws, or when a result has the wrong shape.
 */
export async function runCheckFile(
  journalRoot: string | null,
  id: string,
  options: Record<string, unknown>,
  paper: Paper,
): Promise<CheckResult[]> {
  const url = pathToFileURL(resolveCheckFile(journalRoot, id)).href;
  let mod: { default?: { validate?: unknown } };
  try {
    mod = await import(url);
  } catch (e) {
    throw new UserError(messages.pr.checkFileImportFailed(firstLine(e)));
  }
  const check = mod.default;
  if (typeof check?.validate !== 'function') throw new UserError(messages.pr.checkFileNoValidate);
  const own = {
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
  const parsed = (Array.isArray(res) ? z.array(CheckFileResult) : CheckFileResult).safeParse(res);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new UserError(
      messages.pr.checkFileBadResult(issue?.path.join('.') ?? '', issue?.message ?? 'invalid'),
    );
  }
  return [parsed.data].flat();
}
