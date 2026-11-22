/**
 * journal-checks.ts: the journal's own check files, named in `journal.yml` `checks:` by a
 * relative `./` path into the journal repository [R208].
 *
 * A check file loads from the journal clone, where myst-cli is not installed, so it gets
 * {@link Paper}: plain data and helpers.
 */
import { readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { CheckStatus, type CheckResult } from '@curvenote/check-definitions';
import { toText, type GenericNode, type GenericParent } from 'myst-common';
import { selectAll } from 'unist-util-select';
import * as messages from './messages.js';
import { UserError, firstLine } from './messages.js';
import { parseYaml } from './yaml-io.js';
import type { JournalConfig, Registry } from './schema.js';

/** A frontmatter part's tree, by part name, such as `abstract`. */
export type Parts = Record<string, GenericParent>;

/** One page of the paper, as MyST processed it. */
export interface PaperPage {
  /** Absolute path to the page's file. */
  file: string;
  /** The frontmatter as MyST resolved it: fields the page does not set, such as `authors` and
   *  `keywords`, come from the project frontmatter in `myst.yml`. */
  frontmatter: Record<string, any>;
  /** The frontmatter block at the top of the file, as written; see {@link readFileFrontmatter}. */
  fileFrontmatter: Record<string, any> | null;
  mdast: GenericParent;
  /** The content of the parts the page's frontmatter sets. `frontmatter.parts` holds only
   *  pointers to them. */
  parts: Parts;
}

/** The paper's data, which `readPaper` builds once per run and each check file gets a copy of.
 *  Fields are only ever added [R208]. */
export interface PaperData {
  /** Absolute path to the paper folder. */
  root: string;
  /** The project frontmatter as MyST resolved it. */
  project: Record<string, any>;
  /** The content of the parts the project frontmatter sets. */
  projectParts: Parts;
  /** The paper's `myst.yml`, as written. */
  config: Record<string, any>;
  /** The paper's repository as `owner/name`, as `oak validate` found it; null when unknown. */
  repo: string | null;
  /** The journal repository the check file comes from, as `oak validate` reads it. */
  journal: {
    /** `journal.yml`, with oak's defaults filled in. */
    config: JournalConfig;
    /** The entries of `registry/papers.yml` oak accepts; empty when there is no registry. */
    registry: Registry;
  };
  /** One per page, in table-of-contents order: the root page, which Curvenote's checks read as
   *  the article, then the rest. */
  pages: PaperPage[];
}

/** What a check file's `validate` gets: its copy of the data, plus helpers. */
export interface Paper extends PaperData {
  toText(node: GenericNode | GenericNode[]): string;
  selectAll(selector: string, node: GenericNode): GenericNode[];
  /** See {@link positionIn}. */
  positionOf(node: GenericNode): GenericNode['position'];
}

/** The fields of {@link PaperData} that come from MyST's processed project
 *  (`MystEdge.paperForChecks`). */
export type PaperFromMyst = Omit<PaperData, 'config' | 'repo' | 'journal'>;

/**
 * The frontmatter block at the top of a markdown page, parsed: `{}` when the page has none, null
 * when it does not parse to a mapping, or when the page is not a `.md` file. MyST reports a block
 * that does not parse under its `frontmatter-is-yaml` rule.
 */
export function readFileFrontmatter(file: string): Record<string, any> | null {
  if (extname(file) !== '.md') return null;
  const block = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(
    readFileSync(file, 'utf8'),
  );
  if (!block) return {};
  let value: unknown;
  try {
    value = parseYaml(block[1] ?? '', file).toJS();
  } catch {
    return null;
  }
  if (value == null) return {};
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

/**
 * The node's own `position`, else one on the start line of the nearest node before it in its
 * page's `mdast` that has one. MyST gives no `position` to the nodes a directive makes, such as a
 * figure or an `{image}`. Undefined for a node in no page's `mdast`.
 */
function positionIn(pages: PaperPage[], target: GenericNode): GenericNode['position'] {
  if (target.position) return target.position;
  let line: number | undefined;
  // Preorder walk; true once `target` is reached, with `line` the last start line seen.
  const reach = (node: GenericNode): boolean => {
    line = node.position?.start.line ?? line;
    return node === target || (node.children ?? []).some(reach);
  };
  for (const page of pages) {
    line = undefined;
    if (reach(page.mdast)) {
      return line ? { start: { line, column: 1 }, end: { line, column: 1 } } : undefined;
    }
  }
  return undefined;
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

/** A check file's default export. */
interface CheckFile {
  validate(paper: Paper, options: Record<string, unknown>): unknown;
}

/**
 * Imports the check file at `abs` and returns its default export, once it has a `validate`
 * function. Throws a {@link UserError} when the file does not load or has no `validate`.
 */
async function importCheckFile(abs: string): Promise<CheckFile> {
  let mod: { default?: Partial<CheckFile> };
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (e) {
    throw new UserError(messages.pr.checkFileImportFailed(firstLine(e)));
  }
  const check = mod.default;
  if (typeof check?.validate !== 'function') throw new UserError(messages.pr.checkFileNoValidate);
  return check as CheckFile;
}

/**
 * Imports the check file `id` names and runs its `validate` on a copy of `readPaper()`'s data, so a
 * check that edits a tree leaves the next one unaffected. Returns the results; an empty list adds
 * no row. Throws a {@link UserError} when the file does not load or has no `validate`, when oak
 * cannot read the paper, when `validate` throws, or when a result has the wrong shape.
 */
export async function runCheckFile(
  journalRoot: string | null,
  id: string,
  options: Record<string, unknown>,
  readPaper: () => PaperData,
): Promise<CheckResult[]> {
  const check = await importCheckFile(resolveCheckFile(journalRoot, id));
  let own: Paper;
  try {
    const copy = structuredClone(readPaper());
    own = { ...copy, toText, selectAll, positionOf: (node) => positionIn(copy.pages, node) };
  } catch (e) {
    throw new UserError(messages.pr.checkFilePaperUnreadable(firstLine(e)));
  }
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
