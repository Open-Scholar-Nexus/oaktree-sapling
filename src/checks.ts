/**
 * The editorial checks a journal turns on in `journal.yml` `checks:`, from the MIT-licensed
 * `@curvenote/check-implementations` and `@curvenote/check-definitions` (credited in README.md).
 * The journal picks the set and an author cannot weaken it. MyST's `error_rules` are the
 * author's, so they do not decide whether a paper passes.
 *
 * A journal's own check files run beside them (journal-checks.ts) [R208].
 *
 * `runChecks` runs them; `toCheckRun` turns the results into a GitHub Check Run.
 */
import { basename, isAbsolute, relative } from 'node:path';
import { DERIVED_CONFIG_FILE } from './yaml-io.js';
import * as messages from './messages.js';
import { annotate, firstLine, UserError } from './messages.js';
import { isCheckFile, runCheckFile, type Paper } from './journal-checks.js';
import { GATED_PATHS, underPaths } from './schema.js';
import type { ISession } from 'myst-cli';
import {
  checks as CURVENOTE_DEFINITIONS,
  CheckStatus,
  type Check,
  type CheckDefinition,
  type CheckResult,
  type CheckTags,
} from '@curvenote/check-definitions';

// Imported only when checks run, inside the bundle: the catalog loads myst-cli, which crashes
// unbundled on Node 24 [R51]. The definitions package is safe to import statically.
type CheckInterface = CheckDefinition & {
  validate: (
    session: ISession,
    options: Check,
  ) => Promise<CheckResult | CheckResult[]> | CheckResult | CheckResult[];
};
/** A problem Curvenote's `validateCheck` reports, as `simple-validators` shapes it. */
type ValidationMessage = { property: string; message: string };
async function curvenoteChecks() {
  const mod = await import('@curvenote/check-implementations');
  return { catalog: mod.checks as CheckInterface[], validateCheck: mod.validateCheck };
}

// One import site for curvenote's types.
export { CheckStatus };
export type { Check, CheckDefinition, CheckResult, CheckTags };

/** curvenote's result carries no id; we add the journal's, so the report can group results. */
export type EngineCheckResult = CheckResult & { id: string };

/** The ids oak can run: the whole curvenote catalog. */
export const CHECK_CATALOG_IDS = CURVENOTE_DEFINITIONS.map((c) => c.id);

export interface JournalCheck {
  id: string;
  optional?: boolean;
  [k: string]: unknown;
}

/**
 * Runs the journal's checks against a processed myst session (`MystEdge.withProjectSession`).
 * Each result gets the check's id, and `optional` when the journal set it. A catalog check's
 * options get Curvenote's defaults and types, as Curvenote's own runner gives them. An unknown
 * id, an option Curvenote rejects, a check that throws and a broken check file each become one
 * error result, so a misconfigured journal shows up in the report and the remaining checks still
 * run. An option Curvenote ignores adds an optional error row, a warning. A `./` id runs a check
 * file from `journalRoot` on `readPaper()`'s data.
 */
export async function runChecks(
  session: ISession,
  journalChecks: JournalCheck[],
  journalRoot: string | null,
  readPaper: () => Paper,
): Promise<EngineCheckResult[]> {
  // Loaded on first use, so the unit tests run check files without the bundle [R51].
  let curvenote: ReturnType<typeof curvenoteChecks> | undefined;
  let paper: Paper | undefined;
  const out: EngineCheckResult[] = [];
  for (const { optional, ...check } of journalChecks) {
    const flag = optional ? { optional: true } : {};
    let results: CheckResult[];
    try {
      if (isCheckFile(check.id)) {
        results = await runCheckFile(journalRoot, check.id, check, () => (paper ??= readPaper()));
      } else {
        const { catalog, validateCheck } = await (curvenote ??= curvenoteChecks());
        const impl = catalog.find((c) => c.id === check.id);
        if (!impl) throw new UserError(messages.pr.unknownCheckId(check.id));
        const opts = {
          property: check.id,
          messages: {} as { errors?: ValidationMessage[]; warnings?: ValidationMessage[] },
        };
        const options = validateCheck(session, check, [impl], opts);
        const problems = opts.messages.errors ?? [];
        if (!options || problems.length) {
          throw new UserError(messages.pr.checkOptionsInvalid(problems.map((e) => e.message)));
        }
        // Such as an unknown option, which Curvenote drops: a warning row, so a typo shows.
        const ignored = opts.messages.warnings ?? [];
        if (ignored.length) {
          out.push({
            id: check.id,
            status: CheckStatus.error,
            message: messages.pr.checkOptionsIgnored(ignored.map((w) => w.message)),
            optional: true,
          });
        }
        results = [await impl.validate(session, options)].flat();
      }
    } catch (e) {
      const message = e instanceof UserError ? e.message : messages.pr.checkThrew(firstLine(e));
      out.push({ id: check.id, status: CheckStatus.error, message, ...flag });
      continue;
    }
    for (const r of results) out.push({ ...r, id: check.id, ...flag });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Reporting: the GitHub Check Run payload, posted by gh.ts.
 * ------------------------------------------------------------------------ */

export interface CheckRunAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
}

export interface CheckRun {
  conclusion: 'success' | 'failure';
  title: string;
  summary: string;
  annotations: CheckRunAnnotation[];
}

/** GitHub caps annotations at 50 per check-run API request. */
const GITHUB_MAX_ANNOTATIONS = 50;

/**
 * Maps results to a GitHub Check Run. A failure or error in a required check concludes `failure`
 * and blocks the merge; an optional check's findings are warnings. A result with a file and a
 * position becomes an inline annotation, up to 50.
 *
 * GitHub rejects an annotation batch with a path it cannot resolve, so absolute paths are made
 * relative to `pathBase` (`GITHUB_WORKSPACE`, else the paper root). A finding in the derived
 * `myst.oak.yml` gets no annotation, since that file is gitignored and its lines are not the
 * author's [R82]; it still shows in the summary.
 */
export function toCheckRun(
  results: EngineCheckResult[],
  pathBase?: string,
  notes: string[] = [],
): CheckRun {
  const failed = results.filter(
    (r) => r.status === CheckStatus.fail || r.status === CheckStatus.error,
  );
  const blocking = failed.filter((r) => !r.optional);
  const passed = results.filter((r) => r.status === CheckStatus.pass);

  const conclusion: CheckRun['conclusion'] = blocking.length ? 'failure' : 'success';
  // `oak validate` prints this title too, and the comment's headline repeats it. An optional
  // finding counts as a warning.
  const title = messages.pr.checkRunTitle(
    passed.length,
    blocking.length,
    failed.length - blocking.length,
  );

  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const rows = results
    .map((r) =>
      messages.pr.checkTableRow(esc(r.id), r.status, Boolean(r.optional), esc(r.message ?? '')),
    )
    .join('\n');
  const table = `${messages.pr.checkTableHeader}\n${rows}`;
  // Notes describe the run itself and never change `conclusion`; they render above the table.
  const summary = notes.length
    ? `${notes.map(messages.pr.checkRunNote).join('\n>\n')}\n\n${table}`
    : table;

  const annotations: CheckRunAnnotation[] = failed
    .filter((r) => r.file && r.position && basename(r.file) !== DERIVED_CONFIG_FILE)
    .slice(0, GITHUB_MAX_ANNOTATIONS)
    .map((r) => ({
      path: pathBase && isAbsolute(r.file!) ? relative(pathBase, r.file!) : r.file!,
      start_line: r.position!.start.line,
      end_line: (r.position!.end ?? r.position!.start).line,
      annotation_level: (r.optional ? 'warning' : 'failure') as 'warning' | 'failure',
      message: [r.message, r.help].filter(Boolean).join('; '),
    }));

  return { conclusion, title, summary, annotations };
}

/* --------------------------------------------------------------------------
 * Posting to the pull request. The `pull_request` job that runs `oak validate` on the pull
 * request's code holds no write token, so it only writes the report. The trusted `workflow_run`
 * job then runs `oak post-checks`, which posts the report as a Check Run and as a sticky comment,
 * since authors rarely open a Check Run's details. It never reruns validate.
 * ------------------------------------------------------------------------ */

/** The sticky comment's header. Posted comments carry it in their upsert key
 *  `<!-- oak-sticky: oak-journal-checks -->`, so renaming it breaks them. */
export const STICKY_CHECKS = 'oak-journal-checks';

/** The `oak validate --report` payload. post-checks only uses `checkRun`. */
export interface ChecksReport {
  status?: 'ok' | 'error';
  checkRun: CheckRun;
  /** `oak validate`'s notes [R82], already part of `checkRun.summary`. */
  notes?: string[];
  [k: string]: unknown;
}

/**
 * The sticky comment for a report: the sticky marker, a headline from the Check Run's
 * conclusion and title, the same table, and a footer.
 */
export function checksComment(report: ChecksReport, gatedTouched: string[] | null = []): string {
  const { conclusion, title, summary } = report.checkRun;
  const banner = gatedFlagged(gatedTouched) ? [gatedWarning(gatedTouched), ''] : [];
  return [
    messages.stickyMarker(STICKY_CHECKS),
    ...banner,
    messages.pr.checksHeadline(conclusion === 'success', title),
    '',
    summary,
    '',
    messages.pr.checksFooter,
  ].join('\n');
}

/** The changed files under {@link GATED_PATHS} [design §6a], or null when the list of changed
 *  files is null. A gated file is one listed in CODEOWNERS, so changing it needs an editor's
 *  review. It can also change how the checks run, so post-checks warns that the report cannot be
 *  fully trusted [R83]. */
export function gatedPathsTouched(changed: string[] | null): string[] | null {
  return changed && changed.filter((p) => underPaths(GATED_PATHS, p));
}

/** Whether post-checks warns: a gated file changed, or the changed files are unknown (null). */
function gatedFlagged(touched: string[] | null): boolean {
  return touched === null || touched.length > 0;
}

/** The warning for a pull request that changes a gated file, or whose changed files could not
 *  all be listed (null). It never changes the conclusion, since upgrade pull requests edit these
 *  files too. Shown in the comment and the Check Run. */
export function gatedWarning(touched: string[] | null): string {
  if (touched === null) return messages.pr.gatedWarningUnlisted(GATED_PATHS.map((p) => `\`${p}\``));
  const shown = touched
    .slice(0, 5)
    .map((f) => `\`${f}\``)
    .join(', ');
  const more = touched.length > 5 ? messages.pr.gatedMore(touched.length - 5) : '';
  return messages.pr.gatedWarning(shown, more);
}

/** Injected so tests can use fakes. The real ones are `gh.realCheckRun` and
 *  `gh.realGhPr.sticky`. */
export interface PostChecksDeps {
  checkRun: { create(repo: string, headSha: string, name: string, run: CheckRun): void };
  sticky(repoRoot: string, prNumber: string, header: string, body: string): void;
}

export interface PostChecksOutcome {
  status: 'ok' | 'error';
  checkRunPosted: boolean;
  commentPosted: boolean;
  warnings: string[];
}

/**
 * `oak post-checks`: posts the report's Check Run, and a commit status with the same result, on
 * the pull request's head commit and, given a pull request number, updates the sticky comment.
 * Posting needs `GH_TOKEN`.
 */
export function cmdPostChecks(
  input: {
    report: ChecksReport;
    repo: string;
    sha: string;
    pr?: string;
    gatedTouched?: string[] | null;
  },
  deps: PostChecksDeps,
): PostChecksOutcome {
  const { report, repo, sha, pr } = input;
  const gatedTouched = input.gatedTouched === undefined ? [] : input.gatedTouched;
  const warnings: string[] = [];
  let checkRunPosted = false;
  let commentPosted = false;

  // The warning shows on the check itself and `conclusion` is unchanged: upgrade pull requests
  // change gated files too, and CODEOWNERS is the gate [R83].
  const checkRunToPost = gatedFlagged(gatedTouched)
    ? {
        ...report.checkRun,
        title:
          gatedTouched === null
            ? messages.pr.checkRunTitleGatedUnlisted(report.checkRun.title)
            : messages.pr.checkRunTitleGatedTouched(report.checkRun.title),
        summary: `${gatedWarning(gatedTouched)}\n\n${report.checkRun.summary}`,
      }
    : report.checkRun;

  try {
    deps.checkRun.create(repo, sha, 'Journal checks', checkRunToPost);
    checkRunPosted = true;
  } catch (e) {
    const msg = messages.workflow.postChecksCheckRunFailed((e as Error).message);
    warnings.push(msg);
    process.stderr.write(annotate('warning', msg) + '\n');
  }

  if (pr) {
    try {
      deps.sticky('.', pr, STICKY_CHECKS, checksComment(report, gatedTouched));
      commentPosted = true;
    } catch (e) {
      const msg = messages.workflow.postChecksCommentFailed((e as Error).message);
      warnings.push(msg);
      process.stderr.write(annotate('warning', msg) + '\n');
    }
  }

  // The Check Run and its commit status are the merge gate, so failing to post them is an error:
  // the pull request would stay blocked with no explanation. A failed comment only warns [R144].
  return {
    status: checkRunPosted ? 'ok' : 'error',
    checkRunPosted,
    commentPosted,
    warnings,
  };
}
