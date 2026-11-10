/**
 * release.ts: `oak release` from the terminal ({@link runRelease}), and the tag's Deposit version
 * build it deposits.
 *
 * The CI build runs the paper's code with no token, so its artifact is only read and uploaded.
 * The git and gh side is injected (`CiBuildSource`; the real one is in gh.ts).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative } from 'node:path';
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { pollUntil } from './poll.js';
import { parsePaperTag, PINS_REL, type PaperTag } from './projects.js';
import { compareEngineVersions, doiBranch, parseZenodoDoi } from './schema.js';
import { MIN_ENGINE_KEY } from './upgrade.js';
import { DERIVED_CONFIG_FILE, parseYaml } from './yaml-io.js';
import type { DepositState } from './zenodo.js';

/* --------------------------------------------------------------------------
 * The build `oak release deposit` deposits
 * ------------------------------------------------------------------------ */

/** The path of the Deposit version workflow in a paper repo, as GitHub reports it in a run's
 *  `path`. */
export const DEPOSIT_WORKFLOW_PATH = '.github/workflows/deposit-version.yml';
/** The Deposit version job that builds the paper, with no Zenodo token. */
export const DEPOSIT_BUILD_JOB = 'build';
/** The Deposit version job that deposits with a Zenodo token on GitHub, after the build job. */
export const DEPOSIT_PUBLISH_JOB = 'publish';
/** The artifact the build job uploads. */
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

/** The command `oak release deposit`'s messages name. */
const DEPOSIT_STEP = 'release deposit';

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
  if (!job) {
    throw new UserError(msg.workflow.releaseNoBuildJob(DEPOSIT_STEP, run.url, DEPOSIT_BUILD_JOB));
  }
  if (job.status !== 'completed') throw new UserError(msg.workflow.releaseRunPending(run.url));
  if (job.conclusion !== 'success') {
    throw new UserError(
      msg.workflow.releaseRunFailed(DEPOSIT_STEP, run.url, String(job.conclusion)),
    );
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

/* --------------------------------------------------------------------------
 * `oak release` from the terminal
 * ------------------------------------------------------------------------ */

/** The file the tag's GitHub release holds once it is deposited. */
export const DEPOSITED_ASSET = 'publication-provenance.json';

/** The waits: the run to appear, then its jobs (a paper environment can take long to install). */
export const RUN_WAIT = { tries: 40, intervalMs: 15_000 };
export const BUILD_WAIT = { tries: 180, intervalMs: 15_000 };
/** A line every 5 minutes while nothing changes, so the editor sees oak is still waiting. */
const HEARTBEAT_TRIES = 20;

/** What {@link runRelease} does on GitHub, with the editor's gh login (`realReleaseSource` in
 *  gh.ts). The git calls run in the temporary clone `clone` returns. */
export interface ReleaseSource extends Pick<CiBuildSource, 'tagCommit' | 'pushRuns' | 'jobs'> {
  /** The repo's version tags, `vX.Y.Z` and `<id>/vX.Y.Z` ({@link parsePaperTag}). */
  versionTags(repo: string): string[];
  /** Clones `repo` into a new temporary folder named for `tag` (clean.ts `clonePrefix`), and
   *  returns it. */
  clone(repo: string, tag: string): string;
  /** Fetches the branches and tags into `clone`. */
  fetch(clone: string): void;
  /** The head of the default branch as last fetched. */
  head(clone: string): { sha: string; subject: string };
  /** `path` at commit `ref`, or null when it has no such file. */
  fileAt(clone: string, ref: string, path: string): string | null;
  checkout(clone: string, ref: string): void;
  /** The local `branch`'s commit once origin's `branch` is the same, else null. */
  pushedHead(clone: string, branch: string): string | null;
  /** The open pull request from `branch` of the repo itself, or null. */
  openPr(repo: string, branch: string): { number: number; url: string } | null;
  markChecksSkipped(repo: string, sha: string): void;
  allowsMergeCommit(repo: string): boolean;
  /** Merges pull request `pr` if its head is still `sha` and returns the commit the merge put on
   *  the base. Throws when GitHub refuses. */
  merge(repo: string, pr: number, sha: string, method: 'merge' | 'squash'): string;
  /** Creates `tag` at `sha`. Throws a UserError when GitHub does not create it, with its own
   *  message when the tag was created after the clone read the tags. */
  createTag(repo: string, tag: string, sha: string): void;
  /** `git log --oneline from..to`. */
  commitsBetween(clone: string, from: string, to: string): string[];
  /** The asset names of the tag's GitHub release; none without a release. */
  releaseAssets(repo: string, tag: string): string[];
}

export interface ReleaseInput {
  repo: string;
  /** `vX.Y.Z` for the paper of a paper repository, `<id>/vX.Y.Z` for the paper `papers/<id>` of
   *  a co-located one. */
  tag: string;
  /** `--sandbox`: where a first deposit reserves the DOI. */
  sandbox: boolean;
  publish: boolean;
  /** The command that resumes this release, printed when it stops early. */
  rerun: string;
}

export interface ReleaseDeps {
  src: ReleaseSource;
  hasToken(sandbox: boolean): boolean;
  readDepositState(conceptDoi: string, sandbox: boolean): Promise<DepositState>;
  /** Throws a UserError when `version`, the oak myst.yml pins, is older than the first that has
   *  `oak release reserve-doi` and `oak release deposit` (pinned.ts `DEPOSIT_MIN_VERSION`). */
  checkPin(version: string): void;
  /** Reserves the DOI: `oak release reserve-doi` with the pinned oak for the paper at
   *  `paperRoot` in the clone, on the default branch, which opens the DOI pull request. */
  reserveDoi(paperRoot: string, sandbox: boolean): Promise<number>;
  /** Fills the Zenodo draft: `oak release deposit` with the pinned oak for the paper at
   *  `paperRoot` in the clone, at the tag. */
  deposit(paperRoot: string): Promise<number>;
  confirm(plan: string[]): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

/** How a run of {@link runRelease} ended, and its exit code. */
export type ReleaseReason =
  'deposited' | 'already-deposited' | 'deposited-by-ci' | 'declined' | 'step-failed' | 'wait-limit';

export interface ReleaseOutcome {
  code: number;
  reason: ReleaseReason;
}

/** The reasons that leave the version deposited. */
export const DEPOSITED: readonly ReleaseReason[] = [
  'deposited',
  'already-deposited',
  'deposited-by-ci',
];

/** A wait that reached its limit; the run exits 3 and a rerun continues. */
class WaitTimeout extends Error {}

/** A pinned step that failed; its own output said why, and the run exits with `code`. */
class StepFailed extends Error {
  constructor(readonly code: number) {
    super(`step exited ${code}`);
  }
}

/** A pinned step's exit code as `oak release` reports it: 0 and 1 (a bug) as they are, any other
 *  failure 2, so a step's own 3 is never taken for a wait that reached its limit. */
function exitOf(code: number): number {
  if (code === 0 || code === 1) return code;
  return 2;
}

/** `src` with each call's failure turned into `releaseGitHubFailed`, which says a rerun continues.
 *  `merge` is left out: its failure gets its own message, `releaseMergeRefused`. */
function guarded(src: ReleaseSource): ReleaseSource {
  return new Proxy(src, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function' || key === 'merge') return value;
      return (...args: unknown[]) => {
        try {
          return value.apply(target, args);
        } catch (e) {
          if (e instanceof UserError) throw e;
          throw new UserError(
            msg.workflow.releaseGitHubFailed(e instanceof Error ? e.message : String(e)),
          );
        }
      };
    },
  });
}

/**
 * `oak release` from the terminal. It picks its steps from what already exists on GitHub, so a
 * rerun after a stop continues where the earlier run stopped:
 * 1. The tag exists: wait for its Deposit version run, then deposit at the tag, unless the tag's
 *    GitHub release already holds {@link DEPOSITED_ASSET}.
 * 2. No tag, and the paper's `myst.yml` on the default branch has a DOI: tag the branch head, then
 *    as 1.
 * 3. No tag and no DOI: reserve the DOI, which pushes the paper's DOI branch ({@link doiBranch})
 *    and opens its pull request; merge it at the commit pushed, tag the merge commit, then as 1.
 * The tag names the paper: `vX.Y.Z` the one at the root of a paper repository, `<id>/vX.Y.Z` the
 * folder `papers/<id>` of a co-located one.
 * The refusals it can check first (token, Zenodo draft, sandbox against the committed DOI) come
 * before the confirmation and the first write. Returns the {@link ReleaseOutcome}, whose code
 * is 0 done or declined, 1 a bug, 2 a step failed, 3 a wait reached its limit; throws a UserError
 * when it refuses. The clone is removed on 0 and kept, with its path printed, otherwise.
 */
export async function runRelease(input: ReleaseInput, deps: ReleaseDeps): Promise<ReleaseOutcome> {
  const { repo, tag } = input;
  // A Proxy: every `src` call but `merge` throws a UserError ({@link guarded}).
  const src = guarded(deps.src);
  const clone = src.clone(repo, tag);
  deps.log(msg.workflow.releaseCloned(repo, clone));
  let code: number | null = null;
  let refused = false;
  try {
    const outcome = await releaseFrom(clone, input, src, deps);
    code = outcome.code;
    return outcome;
  } catch (e) {
    if (e instanceof StepFailed) return { code: (code = e.code), reason: 'step-failed' };
    // `main` prints the refusal, so the clone's path goes after it, in the same message.
    if (e instanceof UserError) {
      refused = true;
      throw new UserError(`${e.message}\n${msg.workflow.releaseCloneKept(clone)}`);
    }
    if (!(e instanceof WaitTimeout)) throw e;
    deps.log(e.message);
    deps.log(msg.workflow.releaseRerun(input.rerun));
    return { code: (code = 3), reason: 'wait-limit' };
  } finally {
    // Kept after a failure, for the editor to look into.
    if (code === 0) rmSync(clone, { recursive: true, force: true });
    else if (!refused) deps.log(msg.workflow.releaseCloneKept(clone));
  }
}

async function releaseFrom(
  clone: string,
  input: ReleaseInput,
  src: ReleaseSource,
  deps: ReleaseDeps,
): Promise<ReleaseOutcome> {
  const { repo, tag, publish } = input;
  const deposited = () => src.releaseAssets(repo, tag).includes(DEPOSITED_ASSET);

  const tagged = src.tagCommit(clone, tag);
  const head = src.head(clone);
  const at = tagged ?? head.sha;
  const where = tagged ? `at ${tag}` : 'on the default branch';
  const paper = paperOf(src, clone, at, input, where);
  const branch = doiBranch(paper.id);
  const { doi, pin } = committed(src, clone, at, paper.paperDir);
  const sandbox = doi ? doi.sandbox : input.sandbox;

  // Every refusal comes before anything is asked or changed.
  if (!pin) {
    throw new UserError(
      paper.id
        ? msg.workflow.releaseNoPaperHere(repo, paper.paperDir, where)
        : msg.workflow.releaseNotPaper(repo, where),
    );
  }
  if (tagged && !doi) throw new UserError(msg.workflow.releaseTagNoDoi(tag, repo));
  if (doi && input.sandbox && !doi.sandbox) {
    throw new UserError(msg.workflow.releaseSandboxWithProdDoi(doi.doi));
  }
  if (tagged && deposited()) {
    deps.log(msg.workflow.releaseAlreadyDeposited(tag));
    return { code: 0, reason: 'already-deposited' };
  }
  // The subcommands run with the pinned oak, and the workflows with pins.yml's minimum, so a pin
  // either refuses is refused before the tag.
  deps.checkPin(pin);
  if (paper.minEngine && (compareEngineVersions(pin, paper.minEngine) ?? -1) < 0) {
    throw new UserError(
      msg.workflow.releaseBelowMinEngine(
        posix.join(paper.paperDir, 'myst.yml'),
        pin,
        paper.minEngine,
      ),
    );
  }
  if (!deps.hasToken(sandbox)) throw new UserError(msg.workflow.noZenodoToken('release', sandbox));
  if (doi) await assertDraftFor(doi, tag, deps);

  let sha: string;
  if (tagged) {
    // Only the deposit is left, so nothing is asked.
    deps.log(msg.workflow.releaseUseTag(tag, tagged));
    sha = tagged;
  } else {
    const plan = [
      msg.workflow.releasePlanHeader(repo, paper.id),
      ...(doi
        ? [msg.workflow.releasePlanTagAt(tag, head.sha, head.subject)]
        : [
            msg.workflow.releasePlanReserve(sandbox, src.openPr(repo, branch) !== null),
            msg.workflow.releasePlanMerge,
            msg.workflow.releasePlanTagMerge(tag),
          ]),
      msg.workflow.releasePlanDeposit(tag, sandbox, publish),
      msg.workflow.releasePlanAttach(tag),
    ];
    if (!(await deps.confirm(plan))) return { code: 0, reason: 'declined' };
    // A later version tags the head the confirmation showed.
    sha = doi ? head.sha : await reserveAndMerge(clone, paper, input, src, deps);
    src.createTag(repo, tag, sha);
    deps.log(msg.workflow.releaseTagged(tag, sha));
  }

  const run = await waitForBuild(repo, tag, sha, src, deps);
  if (deposited()) {
    deps.log(msg.workflow.releaseDepositedByCi(tag, run.url));
    return { code: 0, reason: 'deposited-by-ci' };
  }
  src.fetch(clone);
  src.checkout(clone, `refs/tags/${tag}`);
  const code = exitOf(await deps.deposit(join(clone, paper.paperDir)));
  return { code, reason: code === 0 ? 'deposited' : 'step-failed' };
}

/**
 * Reserves the DOI and merges its pull request at the commit this run pushed. It runs on every
 * first-deposit run, so a pull request left open by an earlier run gets this run's commit.
 * Returns the merge commit; throws {@link StepFailed} when the reserve step fails.
 */
async function reserveAndMerge(
  clone: string,
  paper: PaperTag,
  input: ReleaseInput,
  src: ReleaseSource,
  deps: ReleaseDeps,
): Promise<string> {
  const { repo } = input;
  const branch = doiBranch(paper.id);
  const reserved = await deps.reserveDoi(join(clone, paper.paperDir), input.sandbox);
  if (reserved !== 0) throw new StepFailed(exitOf(reserved));
  const pushed = src.pushedHead(clone, branch);
  if (!pushed) throw new UserError(msg.workflow.releaseDoiNotPushed);
  const pr = src.openPr(repo, branch);
  if (!pr) throw new UserError(msg.workflow.releaseNoDoiPr(repo));
  src.markChecksSkipped(repo, pushed);
  const method = src.allowsMergeCommit(repo) ? 'merge' : 'squash';
  let merged: string;
  try {
    merged = src.merge(repo, pr.number, pushed, method);
  } catch (e) {
    throw new UserError(
      msg.workflow.releaseMergeRefused(pr.url, e instanceof Error ? e.message : String(e)),
    );
  }
  deps.log(msg.workflow.releaseMerged(pr.url, merged));
  src.fetch(clone);
  const now = src.head(clone);
  if (now.sha !== merged) {
    deps.log(msg.workflow.releaseMainMoved(merged, src.commitsBetween(clone, merged, now.sha)));
  }
  return merged;
}

interface CommittedDoi {
  doi: string;
  sandbox: boolean;
}

/**
 * The paper `input.tag` names ({@link parsePaperTag}), with pins.yml's `min_engine_version`, both
 * read at commit `ref`. A `<id>/vX.Y.Z` tag needs a co-located repository, and a co-located
 * repository such a tag, so each refusal says which form to use; `where` says where `ref` is.
 */
function paperOf(
  src: ReleaseSource,
  clone: string,
  ref: string,
  input: ReleaseInput,
  where: string,
): PaperTag & { minEngine: string | null } {
  // cmdReleaseVersion checked the form.
  const paper = parsePaperTag(input.tag);
  if (!paper) throw new Error(`not a version tag: ${input.tag}`);
  const text = src.fileAt(clone, ref, PINS_REL);
  const pins = text === null ? null : parseYaml(text, `${PINS_REL} at ${ref.slice(0, 12)}`);
  const colocated = pins?.get('journal_repo') === '.';
  if (colocated && !paper.id) {
    throw new UserError(msg.workflow.releaseNeedsPaperId(input.repo, input.tag, where));
  }
  if (!colocated && paper.id) {
    throw new UserError(msg.workflow.releaseNotColocated(input.repo, input.tag, where));
  }
  const min = pins?.get(MIN_ENGINE_KEY);
  return { ...paper, minEngine: typeof min === 'string' && min ? min : null };
}

/** The Zenodo DOI and the oak version the paper's `myst.yml`, in `paperDir`, holds at commit
 *  `ref`, each null when absent. */
function committed(
  src: ReleaseSource,
  clone: string,
  ref: string,
  paperDir: string,
): { doi: CommittedDoi | null; pin: string | null } {
  const path = posix.join(paperDir, 'myst.yml');
  const text = src.fileAt(clone, ref, path);
  if (text === null) return { doi: null, pin: null };
  const doc = parseYaml(text, `${path} at ${ref.slice(0, 12)}`);
  const version = doc.getIn(['project', 'options', 'oaktree-sapling', 'version']);
  const pin = typeof version === 'string' && version ? version : null;
  const doi = doc.getIn(['project', 'doi']);
  if (typeof doi !== 'string' || !doi) return { doi: null, pin };
  const parsed = parseZenodoDoi(doi);
  if (!parsed) throw new UserError(msg.workflow.doiNotZenodo('release', doi));
  return { doi: { doi, sandbox: parsed.sandbox }, pin };
}

/** Refuses when Zenodo holds no draft for `tag`: no record, or the newest version published with
 *  another version. Published with this version passes; `oak release deposit` finishes it. */
async function assertDraftFor(doi: CommittedDoi, tag: string, deps: ReleaseDeps): Promise<void> {
  let state: DepositState;
  try {
    state = await deps.readDepositState(doi.doi, doi.sandbox);
  } catch (e) {
    throw new UserError(
      msg.workflow.releaseZenodoFailed(e instanceof Error ? e.message : String(e)),
    );
  }
  if (state.kind === 'none') throw new UserError(msg.workflow.releaseNoRecord(doi.doi));
  if (state.kind === 'published' && state.version !== parsePaperTag(tag)!.version.slice(1)) {
    throw new UserError(msg.workflow.releaseNeedsNewVersion(tag, state.recordUrl));
  }
}

/**
 * Waits for the Deposit version run a push of `tag` at `sha` started, until its build job passed
 * and its publish job, if any, finished, so a CI deposit and this one never fill the same draft.
 * Throws a UserError when the build fails and a {@link WaitTimeout} at a limit.
 */
async function waitForBuild(
  repo: string,
  tag: string,
  sha: string,
  src: ReleaseSource,
  deps: ReleaseDeps,
): Promise<CiRun> {
  const actions = `https://github.com/${repo}/actions`;
  deps.log(msg.workflow.releaseWaitRun(tag, actions));
  // Counts the tries after the first, as `unchanged` below does, so both lines come 5 minutes apart.
  let tries = 0;
  const run = await pollUntil(
    () => {
      const found = depositRunFor(src.pushRuns(repo, sha), tag, sha);
      if (!found && tries > 0 && tries % HEARTBEAT_TRIES === 0) {
        deps.log(msg.workflow.releaseNoRunYet(tag, actions));
      }
      tries++;
      return found;
    },
    deps.sleep,
    RUN_WAIT,
  );
  if (!run) throw new WaitTimeout(msg.workflow.releaseNoRunStarted(tag, repo));
  deps.log(msg.workflow.releaseWaitBuild(run.url));
  let last = '';
  let unchanged = 0;
  const done = await pollUntil(
    () => {
      const state = buildState(src.jobs(repo, run.id), run.url);
      const line = msg.workflow.releaseBuildState(state, run.url);
      if (line !== last) {
        deps.log(line);
        last = line;
        unchanged = 0;
      } else if (++unchanged % HEARTBEAT_TRIES === 0) {
        deps.log(msg.workflow.releaseStillWaiting(run.url));
      }
      return state.phase === 'done' ? run : null;
    },
    deps.sleep,
    BUILD_WAIT,
  );
  if (!done)
    throw new WaitTimeout(
      msg.workflow.releaseBuildTimeout(
        run.url,
        (BUILD_WAIT.tries * BUILD_WAIT.intervalMs) / 60_000,
      ),
    );
  return done;
}

/** Where a Deposit version run is: its jobs' progress, with the status GitHub reports. */
export type BuildState =
  | { phase: 'queued' }
  | { phase: 'building'; status: string }
  | { phase: 'publishing'; status: string }
  | { phase: 'done' };

/** The run's {@link BuildState}: `done` once the build passed and the publish job, if any,
 *  finished. Throws a UserError for a failed build or a finished run with no build job. */
function buildState(jobs: CiJob[], url: string): BuildState {
  const build = jobs.find((j) => j.name === DEPOSIT_BUILD_JOB);
  if (!build) {
    if (jobs.length && jobs.every((j) => j.status === 'completed')) {
      throw new UserError(msg.workflow.releaseNoBuildJob('release', url, DEPOSIT_BUILD_JOB));
    }
    return { phase: 'queued' };
  }
  if (build.status !== 'completed') return { phase: 'building', status: build.status };
  if (build.conclusion !== 'success') {
    throw new UserError(msg.workflow.releaseRunFailed('release', url, String(build.conclusion)));
  }
  const publish = jobs.find((j) => j.name === DEPOSIT_PUBLISH_JOB);
  if (publish && publish.status !== 'completed') {
    return { phase: 'publishing', status: publish.status };
  }
  return { phase: 'done' };
}
