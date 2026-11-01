/**
 * release.ts: for a local `oak release`, this gets the build it deposits from the tag's Deposit
 * version run.
 *
 * The CI build runs the paper's code with no token, so its artifact is only read and uploaded.
 * The git and gh side is injected (`CiBuildSource`; the real one is in gh.ts).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { DERIVED_CONFIG_FILE } from './yaml-io.js';

/** The workflow file `templates/paper/.github/workflows/deposit-version.yml`, as a run's `path`
 *  names it, its build job, and the artifact that job uploads. */
export const DEPOSIT_WORKFLOW_PATH = '.github/workflows/deposit-version.yml';
export const DEPOSIT_BUILD_JOB = 'build';
export const RELEASE_ARTIFACT = 'release-build';

/** What the artifact holds, relative to the paper root, as deposit-version.yml uploads it. */
export const RELEASE_BUILD_PATHS = [
  DERIVED_CONFIG_FILE,
  '_build/exports',
  '_build/site/content',
  '_build/templates',
];

/** The one path a complete build may lack: myst writes it only when it downloads a template. */
const OPTIONAL_BUILD_PATH = '_build/templates';

export interface CiRun {
  id: number;
  /** The workflow file, relative to the repo root. */
  path: string;
  event: string;
  /** The tag name, for a tag push. */
  headBranch: string;
  headSha: string;
  url: string;
}

export interface CiJob {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null;
  /** When the job finished, as ISO 8601; null until it does. */
  completedAt: string | null;
}

export interface CiBuildSource {
  /** owner/name from the clone's origin remote, or null. */
  originRepo(paperRoot: string): string | null;
  /** The commit the local tag `tag` names, or null when the clone has no such tag. */
  tagCommit(paperRoot: string, tag: string): string | null;
  headSha(paperRoot: string): string;
  /** When commit `sha` was committed, in seconds since the epoch. */
  commitTime(paperRoot: string, sha: string): number;
  /** Whether tracked files differ from HEAD. */
  trackedChanges(paperRoot: string): boolean;
  /** The workflow runs a push started on commit `sha`, newest first. */
  pushRuns(repo: string, sha: string): CiRun[];
  jobs(repo: string, runId: number): CiJob[];
  /** Downloads artifact `name` of run `runId` into the empty directory `dest`. */
  download(repo: string, runId: number, name: string, dest: string): void;
}

/** The commit of `tag`, once the clone at `paperRoot` is at it with no tracked changes; else
 *  throws a UserError saying which. */
export function assertAtTag(paperRoot: string, tag: string, src: CiBuildSource): string {
  const sha = src.tagCommit(paperRoot, tag);
  if (!sha) throw new UserError(msg.workflow.releaseNoTagHere(tag));
  const head = src.headSha(paperRoot);
  if (head !== sha) throw new UserError(msg.workflow.releaseNotAtTag(tag, head));
  if (src.trackedChanges(paperRoot)) throw new UserError(msg.workflow.releaseTrackedChanges(tag));
  return sha;
}

/** The newest Deposit version run that a push of `tag` at `sha` started, or null. */
export function depositRunFor(runs: CiRun[], tag: string, sha: string): CiRun | null {
  return (
    runs.find(
      (r) =>
        r.path === DEPOSIT_WORKFLOW_PATH &&
        r.event === 'push' &&
        r.headBranch === tag &&
        r.headSha === sha,
    ) ?? null
  );
}

/**
 * Downloads the tag's build into `paperRoot`, replacing {@link RELEASE_BUILD_PATHS} there, and
 * returns its run and when its build job finished. Throws a UserError while the build job runs,
 * when it did not succeed, when there is no run or no build job, and when the artifact lacks a
 * path, before anything in `paperRoot` is replaced. Only the build job is read, so a paper still
 * carrying a publish job beside it works too.
 */
export function fetchCiBuild(
  paperRoot: string,
  tag: string,
  sha: string,
  src: CiBuildSource,
): { run: CiRun; builtAt: string | null } {
  const repo = src.originRepo(paperRoot);
  if (!repo) throw new UserError(msg.workflow.releaseNoOrigin(paperRoot));
  const fromGitHub = <T>(call: () => T): T => {
    try {
      return call();
    } catch (e) {
      throw new UserError(msg.workflow.releaseCiFailed(e instanceof Error ? e.message : String(e)));
    }
  };
  const run = depositRunFor(
    fromGitHub(() => src.pushRuns(repo, sha)),
    tag,
    sha,
  );
  if (!run) throw new UserError(msg.workflow.releaseNoRun(tag, repo));
  const job = fromGitHub(() => src.jobs(repo, run.id)).find((j) => j.name === DEPOSIT_BUILD_JOB);
  if (!job) throw new UserError(msg.workflow.releaseNoBuildJob(run.url, DEPOSIT_BUILD_JOB));
  if (job.status !== 'completed') throw new UserError(msg.workflow.releaseRunPending(run.url));
  if (job.conclusion !== 'success') {
    throw new UserError(msg.workflow.releaseRunFailed(run.url, String(job.conclusion)));
  }

  const tmp = mkdtempSync(join(tmpdir(), 'oak-release-build-'));
  try {
    fromGitHub(() => src.download(repo, run.id, RELEASE_ARTIFACT, tmp));
    const missing = RELEASE_BUILD_PATHS.filter(
      (rel) => rel !== OPTIONAL_BUILD_PATH && !existsSync(join(tmp, rel)),
    );
    if (missing.length) throw new UserError(msg.workflow.releaseIncompleteBuild(run.url, missing));
    for (const rel of RELEASE_BUILD_PATHS) {
      rmSync(join(paperRoot, rel), { recursive: true, force: true });
      if (existsSync(join(tmp, rel))) {
        cpSync(join(tmp, rel), join(paperRoot, rel), { recursive: true });
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { run, builtAt: job.completedAt };
}

/**
 * Refuses a local build older than the tag's commit, made at `commitTime` (seconds): a build
 * left from an earlier tag. Checks the files the deposit reads, the PDF and the HTML build's
 * page content.
 */
export function assertBuiltAfter(
  paperRoot: string,
  pdf: string,
  commitTime: number,
  tag: string,
): void {
  const content = join(paperRoot, '_build', 'site', 'content');
  const pages = existsSync(content)
    ? readdirSync(content)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(content, f))
    : [];
  const stale = [pdf, ...pages].filter((f) => statSync(f).mtimeMs < commitTime * 1000);
  if (stale.length) {
    throw new UserError(
      msg.workflow.releaseStaleBuild(
        tag,
        stale.map((f) => relative(paperRoot, f)),
      ),
    );
  }
}

/** The version in `typst --version` output (`typst 0.14.2 (b33de9de)`), or null. */
export function parseTypstVersion(out: string): string | null {
  return /^typst (\S+)/.exec(out.trim())?.[1] ?? null;
}
