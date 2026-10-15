/**
 * artifact.ts: the files Stage 1 leaves beside its output for Stage 2, and the pull request check
 * Stage 2 runs before writing to a pull request [R26] [R136].
 *
 * Stage 1 runs the pull request's code, so each file is fork-controlled. The names and places
 * are a contract between engine versions: Stage 1 and Stage 2 may run different ones.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import * as msg from './messages.js';
import { UserError } from './messages.js';

/** Dot names: the site is served. */
export const SITE_FILES = { pr: '.pr-number', paper: '.paper' } as const;
export const CHECKS_FILES = { pr: 'pr-number', paper: 'paper' } as const;
type Names = typeof SITE_FILES | typeof CHECKS_FILES;

const PR_NUMBER = /^[0-9]{1,10}$/;
const SHA = /^[0-9a-f]{40}$/;
/** A folder below the repo root, or `.`: no segment starts with a dot, so none is `..`. */
const PAPER_DIR = /^(\.|[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*)$/;

export function assertPrNumber(n: string): string {
  if (!PR_NUMBER.test(n)) throw new UserError(msg.workflow.previewBadPrNumber(n));
  return n;
}

export function assertPaperDir(p: string): string {
  if (!PAPER_DIR.test(p)) throw new UserError(msg.workflow.badPaperDir(p));
  return p;
}

/** The PR number in `dir/<name>`, or null when absent or blank (a push). A malformed file was
 *  tampered with, so it throws [R136]. */
export function readPrNumber(dir: string, name: string = CHECKS_FILES.pr): string | null {
  const f = join(dir, name);
  if (!existsSync(f)) return null;
  const n = readFileSync(f, 'utf8').trim();
  return n ? assertPrNumber(n) : null;
}

/** {@link readPrNumber} on a site, deleting `.pr-number` even when refused, so it is never
 *  served [R26]. */
export function takePrNumber(siteDir: string): string | null {
  try {
    return readPrNumber(siteDir, SITE_FILES.pr);
  } finally {
    rmSync(join(siteDir, SITE_FILES.pr), { force: true });
  }
}

/** The paper folder in `dir/<name>`, or null when absent, which means `.`: Stage 1 may run an
 *  engine that writes none. A malformed one throws. */
export function readPaperDir(dir: string, name: string = CHECKS_FILES.paper): string | null {
  const f = join(dir, name);
  if (!existsSync(f)) return null;
  const p = readFileSync(f, 'utf8').trim();
  return p ? assertPaperDir(p) : null;
}

/** {@link readPaperDir} on a site, deleting `.paper` so it is never served. */
export function takePaperDir(siteDir: string): string | null {
  try {
    return readPaperDir(siteDir, SITE_FILES.paper);
  } finally {
    rmSync(join(siteDir, SITE_FILES.paper), { force: true });
  }
}

/** The paper a Stage 2 verb works on: the artifact's, else `--paper`, else `.`. Throws when both
 *  are given and differ. */
export function resolvePaperDir(fromFlag: string | undefined, fromArtifact: string | null): string {
  const normal = fromFlag ? posix.normalize(fromFlag).replace(/(.)\/+$/, '$1') : undefined;
  const flagged = normal && normal !== '.' ? assertPaperDir(normal) : undefined;
  if (flagged && fromArtifact && fromArtifact !== '.' && flagged !== fromArtifact) {
    throw new UserError(msg.workflow.paperDirMismatch(fromArtifact, flagged));
  }
  return fromArtifact && fromArtifact !== '.' ? fromArtifact : (flagged ?? '.');
}

/* --------------------------------------------------------------------------
 * The GitHub event, from $GITHUB_EVENT_PATH
 * ------------------------------------------------------------------------ */

export interface GithubEnv {
  GITHUB_EVENT_NAME?: string;
  GITHUB_EVENT_PATH?: string;
}

function readEvent(env: GithubEnv): Record<string, any> | null {
  if (!env.GITHUB_EVENT_PATH || !existsSync(env.GITHUB_EVENT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** The pull request a `pull_request` run builds, or null for any other event. */
export function eventPrNumber(env: GithubEnv): string | null {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  const n = readEvent(env)?.pull_request?.number;
  return typeof n === 'number' ? String(n) : null;
}

/** The commit a `workflow_run` run's Stage 1 built, which GitHub sets and the artifact cannot. */
export function eventHeadSha(env: GithubEnv): string | undefined {
  if (env.GITHUB_EVENT_NAME !== 'workflow_run') return undefined;
  const sha = readEvent(env)?.workflow_run?.head_sha;
  return typeof sha === 'string' && sha ? sha : undefined;
}

/**
 * Writes the pull request number and the paper folder into `dir` for Stage 2, on a
 * `pull_request` run only. `paperRoot` is made relative to `repoRoot`. Returns whether it wrote.
 */
export function writeStage1Files(
  dir: string,
  names: Names,
  paperRoot: string,
  repoRoot: string,
  env: GithubEnv,
): boolean {
  const pr = eventPrNumber(env);
  if (!pr) return false;
  const paper = relative(repoRoot, paperRoot).split(sep).join('/') || '.';
  writeFileSync(join(dir, names.pr), assertPrNumber(pr) + '\n');
  writeFileSync(join(dir, names.paper), assertPaperDir(paper) + '\n');
  return true;
}

/* --------------------------------------------------------------------------
 * The pull request check
 * ------------------------------------------------------------------------ */

/**
 * Throws a UserError unless `pr` is a pull request number whose head is `head`, the commit this
 * run built [R136]. `head` comes from the `workflow_run` event, never from the artifact.
 */
export function verifyPrHead(
  repo: string | null,
  pr: string,
  head: string | undefined,
  prHead: (repo: string, pr: string) => string,
): void {
  assertPrNumber(pr);
  if (!repo) throw new UserError(msg.workflow.prCheckNoRepo(pr));
  if (!head || !SHA.test(head)) throw new UserError(msg.workflow.prCheckNoHead(pr));
  const actual = prHead(repo, pr);
  if (actual !== head) throw new UserError(msg.workflow.prHeadMismatch(pr, actual, head));
}
