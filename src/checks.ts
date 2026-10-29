/**
 * The editorial checks a journal turns on in `journal.yml` `checks:`, from the MIT-licensed
 * `@curvenote/check-implementations` and `@curvenote/check-definitions` (credited in README.md).
 * The journal picks the set and an author cannot weaken it, which is why MyST's `error_rules`,
 * which the author controls, cannot be the gate.
 *
 * `runChecks` runs them; `toCheckRun` turns the results into a GitHub Check Run.
 */
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { DERIVED_CONFIG_FILE } from './yaml-io.js';
import * as messages from './messages.js';
import { annotate } from './messages.js';
import { GATED_PATHS, underPaths } from './schema.js';
import { folderId } from './projects.js';
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
async function curvenoteChecks(): Promise<CheckInterface[]> {
  const mod = await import('@curvenote/check-implementations');
  return mod.checks as CheckInterface[];
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
 * Each result gets the check's id, and `optional` when the journal set it. An unknown id becomes
 * an error result, so a misconfigured journal shows up in the report.
 */
export async function runChecks(
  session: ISession,
  journalChecks: JournalCheck[],
): Promise<EngineCheckResult[]> {
  const catalog = await curvenoteChecks();
  const out: EngineCheckResult[] = [];
  for (const jc of journalChecks) {
    const impl = catalog.find((c) => c.id === jc.id);
    if (!impl) {
      out.push({
        id: jc.id,
        status: CheckStatus.error,
        message: messages.pr.unknownCheckId(jc.id),
      });
      continue;
    }
    const { optional, ...check } = jc;
    const res = await impl.validate(session, check as Check);
    for (const r of Array.isArray(res) ? res : [res]) {
      out.push({ ...r, id: jc.id, ...(optional ? { optional: true } : {}) });
    }
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
 * GitHub rejects an annotation batch with a path it cannot resolve, so paths are made relative
 * to `pathBase` (`GITHUB_WORKSPACE`, else the repository root), a relative one read from
 * `fileBase`, the paper root. A finding in the derived
 * `myst.oak.yml` gets no annotation, since that file is gitignored and its lines are not the
 * author's [R82]; it still shows in the summary.
 */
export function toCheckRun(
  results: EngineCheckResult[],
  pathBase?: string,
  notes: string[] = [],
  fileBase?: string,
): CheckRun {
  const failed = results.filter(
    (r) => r.status === CheckStatus.fail || r.status === CheckStatus.error,
  );
  const blocking = failed.filter((r) => !r.optional);
  const passed = results.filter((r) => r.status === CheckStatus.pass);

  const conclusion: CheckRun['conclusion'] = blocking.length ? 'failure' : 'success';
  // The one count of a run: `oak validate` prints this title too, and the comment's headline
  // repeats it. An optional finding is a warning.
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
      path: annotationPath(r.file!, pathBase, fileBase),
      start_line: r.position!.start.line,
      end_line: (r.position!.end ?? r.position!.start).line,
      annotation_level: (r.optional ? 'warning' : 'failure') as 'warning' | 'failure',
      message: [r.message, r.help].filter(Boolean).join('; '),
    }));

  return { conclusion, title, summary, annotations };
}

/** `file` relative to `pathBase`; a relative `file` is first read from `fileBase` (the paper
 *  root), so a co-located paper's annotation names `papers/<id>/<file>`. */
function annotationPath(file: string, pathBase?: string, fileBase?: string): string {
  if (!pathBase) return file;
  if (isAbsolute(file)) return relative(pathBase, file);
  return fileBase ? relative(pathBase, resolve(fileBase, file)) : file;
}

/* --------------------------------------------------------------------------
 * Posting to the pull request. The `pull_request` job that runs `oak validate` on the pull
 * request's code holds no write token, so it only writes the report. The trusted `workflow_run`
 * job then runs `oak post-checks`, which posts the report as a Check Run and as a sticky comment,
 * since authors rarely open a Check Run's details. It never reruns validate.
 * ------------------------------------------------------------------------ */

/** The sticky comment's header. Do not rename: posted comments carry it in their upsert key
 *  `<!-- oak-sticky: oak-journal-checks -->`. */
export const STICKY_CHECKS = 'oak-journal-checks';

/** The `oak validate --report` payload. post-checks only uses `checkRun`. */
export interface ChecksReport {
  status?: 'ok' | 'error';
  checkRun: CheckRun;
  /** `oak validate`'s notes [R82], already part of `checkRun.summary`. */
  notes?: string[];
  [k: string]: unknown;
}

/** One paper's report, with the paper folder its artifact names (`.` or `papers/<id>`). */
export interface PaperReport {
  paper: string;
  report: ChecksReport;
}

/**
 * The reports of one pull request's papers as the one `Journal checks` result the merge rule
 * reads: failing when any paper's does. One paper's report is returned as it is; none is a pass,
 * since nothing a check reads changed.
 */
export function combineReports(reports: PaperReport[]): ChecksReport {
  if (reports.length === 1) return reports[0]!.report;
  if (reports.length === 0) {
    return {
      status: 'ok',
      checkRun: {
        conclusion: 'success',
        title: messages.pr.checkRunTitleNoPaper,
        summary: messages.pr.checksNoPaper,
        annotations: [],
      },
    };
  }
  const label = (p: string) => folderId(p) ?? p;
  const failed = reports.some((r) => r.report.checkRun.conclusion !== 'success');
  return {
    status: failed ? 'error' : 'ok',
    checkRun: {
      conclusion: failed ? 'failure' : 'success',
      title: messages.pr.checkRunTitlePapers(
        reports.map((r) => `${label(r.paper)}: ${r.report.checkRun.title}`),
      ),
      summary: reports
        .map((r) =>
          [
            messages.pr.checksPaperSection(label(r.paper), r.report.checkRun.title),
            '',
            r.report.checkRun.summary,
          ].join('\n'),
        )
        .join('\n\n'),
      annotations: reports
        .flatMap((r) => r.report.checkRun.annotations ?? [])
        .slice(0, GITHUB_MAX_ANNOTATIONS),
    },
  };
}

/** `report` failed with `reason` above its own summary: what post-checks posts for a fork pull
 *  request that breaks the one-paper rule ({@link forkPaper}). */
export function refusedReport(report: ChecksReport, reason: string): ChecksReport {
  return {
    ...report,
    status: 'error',
    checkRun: {
      ...report.checkRun,
      conclusion: 'failure',
      title: messages.pr.forkRefusedTitle,
      summary: `> ❌ ${reason}\n\n${report.checkRun.summary}`,
    },
  };
}

/**
 * The sticky comment for a report: the sticky marker, a headline from the Check Run's
 * conclusion and title, in a co-located repository the papers the pull request changes
 * (`papers`, their ids), the same table, and a footer.
 */
export function checksComment(
  report: ChecksReport,
  shimTouched: string[] | null = [],
  papers?: string[],
): string {
  const { conclusion, title, summary } = report.checkRun;
  const banner = shimFlagged(shimTouched) ? [shimWarning(shimTouched), ''] : [];
  const named = papers
    ? [papers.length ? messages.pr.checksPapers(papers) : messages.pr.checksNoPaper, '']
    : [];
  return [
    messages.stickyMarker(STICKY_CHECKS),
    ...banner,
    messages.pr.checksHeadline(conclusion === 'success', title),
    '',
    ...named,
    summary,
    '',
    messages.pr.checksFooter,
  ].join('\n');
}

/** The changed files under {@link GATED_PATHS} [design §6a], or null when the list of changed
 *  files is null. A pull request that changes them can change how the checks run, so post-checks
 *  warns that its report cannot be fully trusted [R83]. */
export function frozenPathsTouched(changed: string[] | null): string[] | null {
  return changed && changed.filter((p) => underPaths(GATED_PATHS, p));
}

/** Whether post-checks warns: a gated file changed, or the changed files are unknown (null). */
function shimFlagged(touched: string[] | null): boolean {
  return touched === null || touched.length > 0;
}

/** The warning for a pull request that edits the gated files, or whose changed files could not
 *  all be listed (null). It never changes the conclusion, since upgrade pull requests edit these
 *  files too. Shown in the comment and the Check Run. */
export function shimWarning(touched: string[] | null): string {
  if (touched === null) return messages.pr.shimWarningUnlisted(GATED_PATHS.map((p) => `\`${p}\``));
  const shown = touched
    .slice(0, 5)
    .map((f) => `\`${f}\``)
    .join(', ');
  const more = touched.length > 5 ? messages.pr.shimMore(touched.length - 5) : '';
  return messages.pr.shimWarning(shown, more);
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
 * `oak post-checks`: posts the report's Check Run, and a commit status with the same result, on the pull
 * request's head commit and, given a pull request number, updates the sticky comment. Posting
 * needs `GH_TOKEN`.
 */
export function cmdPostChecks(
  input: {
    report: ChecksReport;
    repo: string;
    sha: string;
    pr?: string;
    shimTouched?: string[] | null;
    /** A co-located repository's paper ids the pull request changes, named in the comment. */
    papers?: string[];
  },
  deps: PostChecksDeps,
): PostChecksOutcome {
  const { report, repo, sha, pr, papers } = input;
  const shimTouched = input.shimTouched === undefined ? [] : input.shimTouched;
  const warnings: string[] = [];
  let checkRunPosted = false;
  let commentPosted = false;

  // Shown on the check itself, but `conclusion` stays: upgrade pull requests edit these files
  // too, and CODEOWNERS is the gate [R83].
  const checkRunToPost = shimFlagged(shimTouched)
    ? {
        ...report.checkRun,
        title:
          shimTouched === null
            ? messages.pr.checkRunTitleShimUnlisted(report.checkRun.title)
            : messages.pr.checkRunTitleShimTouched(report.checkRun.title),
        summary: `${shimWarning(shimTouched)}\n\n${report.checkRun.summary}`,
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
      deps.sticky('.', pr, STICKY_CHECKS, checksComment(report, shimTouched, papers));
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
