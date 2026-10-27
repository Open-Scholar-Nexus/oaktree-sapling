/**
 * release.ts: where `oak release` on an editor's computer gets the build it deposits: the tag's
 * Deposit version run, or a local build after a warning (DOCS.publishLocalBuild).
 *
 * The CI build ran the paper's code with no token, so its artifact is only read and uploaded.
 * The git and gh side is injected (`CiBuildSource`; the real one is in gh.ts).
 */
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { DERIVED_CONFIG_FILE, readDoc } from './yaml-io.js';
import { galleryPluginUrl } from './bootstrap.js';
import type { PinnedEngine } from './pinned.js';

/** The workflow `templates/paper/.github/workflows/deposit-version.yml` names, its build job,
 *  and the artifact that job uploads. */
export const DEPOSIT_WORKFLOW = 'Deposit version';
export const DEPOSIT_BUILD_JOB = 'build';
export const RELEASE_ARTIFACT = 'release-build';

/** What the artifact holds, relative to the paper root, as deposit-version.yml uploads it. */
export const RELEASE_BUILD_PATHS = [
  DERIVED_CONFIG_FILE,
  '_build/exports',
  '_build/site/content',
  '_build/templates',
];

export interface CiRun {
  id: number;
  name: string;
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
}

export interface CiBuildSource {
  /** owner/name from the clone's origin remote, or null. */
  originRepo(paperRoot: string): string | null;
  /** The commit the local tag `tag` names, or null when the clone has no such tag. */
  tagCommit(paperRoot: string, tag: string): string | null;
  headSha(paperRoot: string): string;
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
        r.name === DEPOSIT_WORKFLOW &&
        r.event === 'push' &&
        r.headBranch === tag &&
        r.headSha === sha,
    ) ?? null
  );
}

/**
 * Downloads the tag's build into `paperRoot`, replacing {@link RELEASE_BUILD_PATHS} there, and
 * returns its run. Throws a UserError while the build job runs, when it did not succeed, or when
 * there is no run. Only the build job is read, so a paper still carrying a publish job beside it
 * works too.
 */
export function fetchCiBuild(
  paperRoot: string,
  tag: string,
  sha: string,
  src: CiBuildSource,
): CiRun {
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
  if (!job || job.status !== 'completed')
    throw new UserError(msg.workflow.releaseRunPending(run.url));
  if (job.conclusion !== 'success') {
    throw new UserError(msg.workflow.releaseRunFailed(run.url, String(job.conclusion)));
  }

  const tmp = mkdtempSync(join(tmpdir(), 'oak-release-build-'));
  try {
    fromGitHub(() => src.download(repo, run.id, RELEASE_ARTIFACT, tmp));
    for (const rel of RELEASE_BUILD_PATHS) {
      rmSync(join(paperRoot, rel), { recursive: true, force: true });
      if (existsSync(join(tmp, rel))) {
        cpSync(join(tmp, rel), join(paperRoot, rel), { recursive: true });
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return run;
}

/** The `project.plugins` of the YAML file at `file`, as written: a string, or an entry's
 *  `path`. [] when the file or the list is absent. */
function pluginsIn(file: string): string[] {
  if (!existsSync(file)) return [];
  const list = readDoc(file).toJS()?.project?.plugins;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p: unknown) => {
    if (typeof p === 'string') return [p];
    const path = (p as { path?: unknown } | null)?.path;
    return typeof path === 'string' ? [path] : [];
  });
}

/**
 * The plugins the paper's `myst.yml` lists beyond its edition's and oak's gallery plugin at the
 * pinned version: the code a local build runs that the journal did not choose.
 */
export function addedPlugins(
  paperRoot: string,
  instanceRoot: string | null,
  pin: PinnedEngine | undefined,
): string[] {
  const mystPath = join(paperRoot, 'myst.yml');
  const edition = readDoc(mystPath).getIn(['project', 'options', 'oaktree-sapling', 'edition']);
  const known = new Set(
    instanceRoot && typeof edition === 'string' && edition
      ? pluginsIn(join(instanceRoot, 'editions', `${edition}.yml`))
      : [],
  );
  if (pin) known.add(galleryPluginUrl(pin.engineRepo, pin.version));
  return pluginsIn(mystPath).filter((p) => !known.has(p));
}

/** The version in `typst --version` output (`typst 0.14.2 (b33de9de)`), or null. */
export function parseTypstVersion(out: string): string | null {
  return /^typst (\S+)/.exec(out.trim())?.[1] ?? null;
}
