/**
 * The editorial checks a journal turns on in `journal.yml` `checks:`, from the MIT-licensed
 * `@curvenote/check-implementations` and `@curvenote/check-definitions` (credited in README.md).
 * The journal picks the set and an author cannot weaken it, which is why MyST's `error_rules`,
 * which the author controls, cannot be the gate.
 *
 * `runChecks` runs them; `toCheckRun` turns the results into a GitHub Check Run.
 */
import { basename, isAbsolute, relative } from 'node:path';
import { DERIVED_CONFIG_FILE } from './yaml-io.js';
import * as messages from './messages.js';
import { annotate } from './messages.js';
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
  // The one count of a run: `oak validate` prints this title too, and the comment's headline
  // repeats it. An optional finding is a warning.
  const title = messages.pr.checkRunTitle(
    passed.length,
    blocking.length,
    failed.length - blocking.length,
  );

  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const rows = results
    .map(
      (r) =>
        `| ${esc(r.id)} | ${r.status}${r.optional ? ' (optional)' : ''} | ${esc(r.message ?? '')} |`,
    )
    .join('\n');
  const table = `${messages.pr.checkTableHeader}\n${rows}`;
  // Notes describe the run itself and never change `conclusion`; they render above the table.
  const summary = notes.length
    ? `${notes.map((n) => `> ⚠️ ${n}`).join('\n>\n')}\n\n${table}`
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
 * job then runs `oak check-post`, which posts the report as a Check Run and as a sticky comment,
 * since authors rarely open a Check Run's details. It never reruns validate.
 * ------------------------------------------------------------------------ */

/** The sticky comment's header. Do not rename: posted comments carry it in their upsert key
 *  `<!-- oak-sticky: oak-journal-checks -->`. */
export const STICKY_CHECKS = 'oak-journal-checks';

/** The `oak validate --report` payload. check-post only uses `checkRun`. */
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
export function checksComment(report: ChecksReport, shimTouched: string[] = []): string {
  const { conclusion, title, summary } = report.checkRun;
  const banner = shimTouched.length ? [shimWarning(shimTouched), ''] : [];
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

/** The gated paths [design §6a]: `.github/`, `CODEOWNERS` and `paper-environment.yml`. A pull
 *  request that changes them can change how the checks run, so check-post warns that its report
 *  cannot be fully trusted [R83]. */
export function frozenPathsTouched(changed: string[]): string[] {
  return changed.filter(
    (p) => p === 'CODEOWNERS' || p === 'paper-environment.yml' || p.startsWith('.github/'),
  );
}

/** The warning for a pull request that edits the gated files. It never changes the conclusion,
 *  since upgrade pull requests edit these files too. Shown in the comment and the Check Run. */
export function shimWarning(touched: string[]): string {
  const shown = touched
    .slice(0, 5)
    .map((f) => `\`${f}\``)
    .join(', ');
  const more = touched.length > 5 ? `, +${touched.length - 5} more` : '';
  return messages.pr.shimWarning(shown, more);
}

/** Injected so tests can use fakes. The real ones are `gh.realCheckRun` and
 *  `gh.realGhPr.sticky`. */
export interface CheckPostDeps {
  checkRun: { create(repo: string, headSha: string, name: string, run: CheckRun): void };
  sticky(repoRoot: string, prNumber: string, header: string, body: string): void;
}

export interface CheckPostOutcome {
  status: 'ok' | 'error';
  checkRunPosted: boolean;
  commentPosted: boolean;
  warnings: string[];
}

/**
 * `oak check-post`: posts the report's Check Run on the pull request's head commit and, given a
 * pull request number, updates the sticky comment. Posting needs `GH_TOKEN`.
 */
export function cmdCheckPost(
  input: { report: ChecksReport; repo: string; sha: string; pr?: string; shimTouched?: string[] },
  deps: CheckPostDeps,
): CheckPostOutcome {
  const { report, repo, sha, pr } = input;
  const shimTouched = input.shimTouched ?? [];
  const warnings: string[] = [];
  let checkRunPosted = false;
  let commentPosted = false;

  // Shown on the check itself, but `conclusion` stays: upgrade pull requests edit these files
  // too, and CODEOWNERS is the gate [R83].
  const checkRunToPost = shimTouched.length
    ? {
        ...report.checkRun,
        title: messages.pr.checkRunTitleShimTouched(report.checkRun.title),
        summary: `${shimWarning(shimTouched)}\n\n${report.checkRun.summary}`,
      }
    : report.checkRun;

  try {
    deps.checkRun.create(repo, sha, 'Journal checks', checkRunToPost);
    checkRunPosted = true;
  } catch (e) {
    const msg = messages.workflow.checkPostCheckRunFailed((e as Error).message);
    warnings.push(msg);
    process.stderr.write(annotate('warning', msg) + '\n');
  }

  if (pr) {
    try {
      deps.sticky('.', pr, STICKY_CHECKS, checksComment(report, shimTouched));
      commentPosted = true;
    } catch (e) {
      const msg = messages.workflow.checkPostCommentFailed((e as Error).message);
      warnings.push(msg);
      process.stderr.write(annotate('warning', msg) + '\n');
    }
  }

  // The Check Run is the merge gate, so failing to post it is an error: the pull request would
  // stay blocked with no explanation. A failed comment only warns [R144].
  return {
    status: checkRunPosted ? 'ok' : 'error',
    checkRunPosted,
    commentPosted,
    warnings,
  };
}
