/**
 * `oak conformance`: tests a release of oak on GitHub. It moves a paper repo kept for
 * testing (the test repo) onto the release and checks every path its CI takes: build and
 * GitHub Pages, the editorial checks, a same-repo preview, the Zenodo deposit and,
 * optionally, a preview from a fork. A release passes when all of them do; `npm test` cannot
 * cover these, since they only run on GitHub.
 *
 * Every run works on its own branches, pull requests and a throwaway tag. `reset` removes them,
 * so each run starts clean, and it is idempotent.
 *
 * GitHub calls are injected (`ConformanceGh`; the real one is in gh.ts) so tests run offline.
 * This holds only a token for the test repo; the Cloudflare and Zenodo secrets stay in the
 * test repo and are used by its own runs.
 */
import { STICKY_PREVIEW } from './preview.js';
import { stickyMarker } from './messages.js';
import { RESERVED_BUNDLE_NAMES } from './zenodo.js';
import { UPGRADE_BRANCH_PREFIX } from './upgrade.js';

/** The label on every pull request a run opens, which is how `reset` finds them, including pull
 *  requests from the fork, whose branch names it does not know. */
export const CONFORMANCE_LABEL = 'conformance';

/** Prefix of the branches a run creates in the test repo. */
export const CERT_BRANCH_PREFIX = 'cert-';

/** Marks a run's throwaway tags (`reset` removes `*-cert-*`). The deposit tag cannot use it:
 *  `oak release` needs a plain `vX.Y.Z` (see `CERT_DEPOSIT_TAG`). */
export const CERT_TAG_MARKER = '-cert-';

/** The deposit tag. `oak release` takes only `vX.Y.Z`, so a reserved version that cannot clash
 *  with the test repo's real ones is pushed, published, checked and deleted, every run.
 *  The deposit draft is keyed by the repo, not the tag, so reusing the version is fine. */
export const CERT_DEPOSIT_TAG = 'v0.0.0';

/** The GitHub calls, injected. `repo` is always the test repo (`owner/name`). */
export interface ConformanceGh {
  /** Open pull requests carrying `label`; [] when the label does not exist yet. */
  listOpenPrs(repo: string, label: string): { number: number; headRef: string }[];
  /** Closes pull request #n without merging. */
  closePr(repo: string, prNumber: number): void;
  /** Branch names starting with `prefix`, without `refs/heads/`. */
  listBranches(repo: string, prefix: string): string[];
  /** Deletes a branch; fine if it is already gone. */
  deleteBranch(repo: string, branch: string): void;
  /** Tag names containing `marker`. */
  listTags(repo: string, marker: string): string[];
  /** Deletes a tag; fine if it is already gone. */
  deleteTag(repo: string, tag: string): void;

  // --- moving onto the release, pushing to main ---
  /** Adds `label` to pull request #n, so `reset` can find it. */
  labelPr(repo: string, prNumber: number, label: string): void;
  /** The pull request's head commit, where the merge-blocking Check Run is posted. */
  prHeadSha(repo: string, prNumber: number): string;
  /** Merges pull request #n, deletes its branch, and returns the merge commit. */
  mergePr(repo: string, prNumber: number): string;
  /** Workflow runs for commit `sha` (Paper CI, Journal checks, ...). */
  workflowRunsForCommit(repo: string, sha: string): WorkflowRun[];
  /** Check Runs on commit `sha`, such as the Journal checks one check-post posts. */
  checkRunsForCommit(repo: string, sha: string): CheckRunRef[];

  // --- a same-repo pull request and its preview ---
  /** Opens a pull request from `branch` off `main` with a harmless change (a MyST comment
   *  carrying `marker`), through the Contents API. Returns its number and head commit. */
  openPreviewPr(repo: string, branch: string, marker: string): { number: number; headSha: string };
  /** Comment bodies on pull request #n, to find the preview comment. */
  listIssueComments(repo: string, prNumber: number): string[];

  // --- the deposit (the publish half) ---
  /** `project.doi` from the test repo's `myst.yml` on the default branch, or null. The
   *  deposit test needs a sandbox DOI there. */
  committedDoi(repo: string): string | null;
  /** The oak version pinned in the test repo's `myst.yml`, or null. */
  committedEngineVersion(repo: string): string | null;
  /** The head commit of `main`, where the deposit tag goes. */
  defaultBranchSha(repo: string): string;
  /** Creates tag `tag` at `sha`; the `v*` push starts publish.yml. */
  pushTag(repo: string, tag: string, sha: string): void;
  /** Asset names on the release for `tag`; [] when there is no release yet. */
  releaseAssets(repo: string, tag: string): string[];
  /** Deletes the release for `tag`, and with it the tag; fine if absent. */
  deleteRelease(repo: string, tag: string): void;

  // --- a pull request from a fork and its preview (optional) ---
  /** Deletes `<prefix>*` branches on the fork (with the fork's token), left by a crashed run.
   *  Returns their names. */
  sweepForkBranches(forkRepo: string, forkToken: string, prefix: string): string[];
  /** Opens a pull request from the fork: branches off the test repo's `main` on the fork
   *  (fork token) and pins the oak version to `tag`, so the build really uses the release, then
   *  opens the pull request on the test repo (main token). Returns its number and the
   *  fork branch's head commit. */
  openForkPr(
    baseRepo: string,
    forkRepo: string,
    forkToken: string,
    branch: string,
    tag: string,
    marker: string,
  ): { number: number; headSha: string };
  /** Deletes the run's branch on the fork (fork token); fine if already gone. */
  deleteForkBranch(forkRepo: string, forkToken: string, branch: string): void;
  /** Approves a run waiting for first-time-contributor approval. The approval is on the test
   *  repo, so it uses the main token. Does nothing when no approval is needed. */
  approveWorkflowRun(repo: string, runId: number): void;
}

export interface WorkflowRun {
  id: number; // to approve or poll this specific run
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | … (null until completed)
  url: string;
  event: string; // push | pull_request | …
}

export interface CheckRunRef {
  name: string;
  conclusion: string | null; // null while still running
}

export interface ConformanceDeps {
  gh: ConformanceGh;
  log(msg: string): void;
  /** Waits `ms` between polls; injected so tests do not wait. */
  sleep(ms: number): Promise<void>;
  /** The HTTP status of a GET to `url`, 0 on a network error. */
  probe(url: string): Promise<number>;
  /** Moves `repo` onto release `tag` with `oak upgrade --both`, so the upgrade path is tested
   *  too. Returns its pull request, or `upToDate` when the pin is already `tag`. */
  installEngine(
    repo: string,
    tag: string,
  ): Promise<{ upToDate: boolean; prNumber: number | null; prUrl: string | null }>;
  /** The fork (owned by a second account) and its token, for the optional fork preview; null
   *  when not set up, and that part is skipped. */
  fork?: { repo: string; token: string } | null;
}

/** `reset` needs only the cleanup calls. */
export type ResetDeps = Pick<ConformanceDeps, 'gh' | 'log'>;

export interface Outcome {
  exitCode: number;
  result: Record<string, unknown>;
}

export interface ResetInput {
  /** The test repo, `owner/name`. Pull requests from the fork show up here too; `reset`
   *  never touches the fork itself. */
  repo: string;
}

/**
 * Removes what earlier runs left in the test repo. Closes labelled pull requests first,
 * so the list is clean even if a branch deletion is refused, then deletes `cert-*` branches and
 * `*-cert-*` tags. Anything already gone is skipped.
 */
export async function cmdConformanceReset(input: ResetInput, deps: ResetDeps): Promise<Outcome> {
  const { gh, log } = deps;
  const { repo } = input;

  const closedPrs: number[] = [];
  for (const pr of gh.listOpenPrs(repo, CONFORMANCE_LABEL)) {
    gh.closePr(repo, pr.number);
    closedPrs.push(pr.number);
    log(`closed PR #${pr.number} (${pr.headRef})`);
  }

  // Both prefixes: the run's own `oak upgrade` opens the second, and sweeping only the first
  // made each release testable once [R117]. Deleting a branch closes its pull request.
  const deletedBranches: string[] = [];
  for (const prefix of [CERT_BRANCH_PREFIX, UPGRADE_BRANCH_PREFIX]) {
    for (const branch of gh.listBranches(repo, prefix)) {
      gh.deleteBranch(repo, branch);
      deletedBranches.push(branch);
      log(`deleted branch ${branch}`);
    }
  }

  // The `*-cert-*` tags plus the deposit tag, which has no marker. `listTags` matches
  // substrings, so `v0.0.0` also catches old `v0.0.0-cert-*` tags; the Set removes duplicates.
  const certTags = new Set([
    ...gh.listTags(repo, CERT_TAG_MARKER),
    ...gh.listTags(repo, CERT_DEPOSIT_TAG),
  ]);
  const deletedTags: string[] = [];
  for (const tag of certTags) {
    // A crashed run can leave a release on the deposit tag. Deleting the release also deletes the
    // tag, so the following `deleteTag` finds nothing, which is fine.
    gh.deleteRelease(repo, tag);
    gh.deleteTag(repo, tag);
    deletedTags.push(tag);
    log(`deleted tag ${tag}`);
  }

  const changed = closedPrs.length + deletedBranches.length + deletedTags.length;
  log(changed === 0 ? 'reset: already clean (no-op)' : `reset: cleaned ${changed} item(s)`);

  return {
    exitCode: 0,
    result: { status: 'ok', repo, closedPrs, deletedBranches, deletedTags, changed },
  };
}

/* ==========================================================================================
 * Moving onto the release and testing the push to main
 * ======================================================================================== */

/** How long to wait for real runs. A Paper CI run plus a Pages deploy takes minutes. Tests pass a
 *  `sleep` that does nothing. */
const POLL = { tries: 80, intervalMs: 15_000 };

/** Retries for a URL check: a fresh preview or Pages site can fail briefly after a deploy. */
const PROBE = { tries: 6, intervalMs: 5_000 };

/**
 * A failure that is not oak's: a third party being down or slow (Cloudflare, Pages, Zenodo, the
 * GitHub API), or a timeout. The result is inconclusive rather than failed, so a failed run
 * always means oak is at fault.
 */
export class ThirdPartyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThirdPartyError';
  }
}

/**
 * Calls `attempt` until it returns a value; `null` means keep waiting, and a throw is a real
 * failure (a run that finished and failed). A timeout blames a third party, unless `settled`
 * says every run has finished: then the result is missing, which is a failure [R113].
 */
async function pollUntil<T>(
  label: string,
  attempt: () => T | null,
  deps: { sleep(ms: number): Promise<void>; log(msg: string): void },
  opts: { tries: number; intervalMs: number; settled?: () => boolean } = POLL,
): Promise<T> {
  for (let i = 0; i < opts.tries; i++) {
    const ready = attempt();
    if (ready !== null) return ready;
    if (i < opts.tries - 1) await deps.sleep(opts.intervalMs);
  }
  if (opts.settled?.()) {
    throw new Error(`${label} never appeared, though every run on its commit has finished`);
  }
  throw new ThirdPartyError(
    `timed out waiting for ${label} (${opts.tries}×${opts.intervalMs}ms); slow/stuck third party`,
  );
}

/**
 * A `gh` failure because GitHub could not serve the request (a rate limit, a 5xx, a dropped
 * connection, as gh.ts's `run` formats them) [R113]. A third party's bad day, not oak's.
 *
 * A 401 or 403 that is not a rate limit is oak's: GitHub refused the request, meaning a missing
 * scope or `permissions:` block, or a call that does not apply. Counting those as third-party
 * once hid a bug in this code [R150].
 */
function isGitHubApiFault(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  if (!/^gh \S* ?failed \(exit /.test(m)) return false;
  if (/rate limit|secondary rate|abuse detection|HTTP 429/i.test(m)) return true;
  return /HTTP 5\d\d|ECONNRESET|EAI_AGAIN|ETIMEDOUT|timed out|connection reset|bad gateway|service unavailable/i.test(
    m,
  );
}

/**
 * Checks that a URL serves 200, retrying a network error, 429 or 5xx with backoff. If those
 * persist the result is inconclusive (`ThirdPartyError`); any other 4xx (a 404: nothing was
 * deployed) is a failure.
 */
async function assertServes200(
  deps: { probe(url: string): Promise<number>; sleep(ms: number): Promise<void> },
  url: string,
  label: string,
): Promise<void> {
  const transient = (s: number) => s === 0 || s === 429 || s >= 500;
  let status = 0;
  for (let i = 0; i < PROBE.tries; i++) {
    status = await deps.probe(url);
    if (status === 200) return;
    if (!transient(status)) throw new Error(`${label} ${url} returned ${status}, expected 200`);
    if (i < PROBE.tries - 1) await deps.sleep(PROBE.intervalMs);
  }
  throw new ThirdPartyError(
    `${label} ${url} still ${status} after ${PROBE.tries} tries; transient/outage`,
  );
}

/** null while pending; the ref when it succeeded; throws when it finished otherwise. */
function checkOutcome(runs: CheckRunRef[], name: string): CheckRunRef | null {
  const cr = runs.find((c) => c.name === name);
  if (!cr || cr.conclusion === null) return null;
  if (cr.conclusion !== 'success') throw new Error(`${name} Check Run concluded ${cr.conclusion}`);
  return cr;
}

/** null while running; the run (picked by `find`) when it succeeded; throws with its URL when it
 *  finished otherwise. `label` names the run in that error. */
function runOutcome(
  runs: WorkflowRun[],
  find: (r: WorkflowRun) => boolean,
  label: string,
): WorkflowRun | null {
  const run = runs.find(find);
  if (!run || run.status !== 'completed') return null;
  if (run.conclusion !== 'success')
    throw new Error(`${label} concluded ${run.conclusion}: ${run.url}`);
  return run;
}

/** The GitHub Pages URL of a repo (`owner.github.io/name/`). */
export function pagesUrlFor(repo: string): string {
  const [owner, name] = repo.split('/');
  return `https://${owner}.github.io/${name}/`;
}

export interface RunInput {
  repo: string;
  tag: string; // engine version V under test
  runId?: string; // namespaces the cert-<runId> preview branch; defaults to a timestamp
}

/** The preview comment's marker. preview.ts owns it; keep them in step. */
const PREVIEW_STICKY_MARK = stickyMarker(STICKY_PREVIEW);

/** The `*.pages.dev` URL in a preview comment, or null when the comment fell back to an
 *  artifact link, so there is no preview to check. */
function extractPreviewUrl(commentBody: string): string | null {
  const m = commentBody.match(/https:\/\/[^\s)]*pages\.dev[^\s)]*/);
  return m ? m[0] : null;
}

/**
 * Tests a release: moves the test repo onto it through an upgrade pull request, lets the
 * required Journal checks pass before merging (which also tests check and check-post), then
 * checks each result itself, not only run conclusions: Paper CI passed, Pages serves 200, and
 * the Journal checks Check Run was posted on main. The preview, deposit and fork phases follow.
 */
export async function cmdConformanceRun(input: RunInput, deps: ConformanceDeps): Promise<Outcome> {
  const { gh, log, sleep, probe, installEngine, fork } = deps;
  const { repo, tag } = input;
  const runId = input.runId ?? String(Date.now());
  /** Every run this commit started has finished, so a missing result is missing, not late. */
  const settled = (sha: string) => () => {
    const runs = gh.workflowRunsForCommit(repo, sha);
    return runs.length > 0 && runs.every((r) => r.status === 'completed');
  };
  let phase = 'push-main';
  // The paths that passed, added as each phase passes (the fork phase adds its own).
  const paths: string[] = ['push-main', 'preview-same-repo', 'deposit'];
  const skipped: string[] = [];
  let forkResult: Record<string, unknown> = {};
  try {
    // 1. Start clean: remove what earlier runs left.
    await cmdConformanceReset({ repo }, { gh, log });

    // 2. Move onto the release through `oak upgrade`, so the upgrade itself is tested.
    const up = await installEngine(repo, tag);
    if (up.upToDate || up.prNumber === null) {
      return {
        exitCode: 1,
        result: {
          status: 'failed',
          tag,
          path: 'install',
          failure: `no upgrade PR: the test repo already pins ${tag}. Cut a fresh dev tag so push→main has a change to test.`,
        },
      };
    }
    const prNumber = up.prNumber;
    gh.labelPr(repo, prNumber, CONFORMANCE_LABEL);
    log(`upgrade PR #${prNumber}: ${up.prUrl}`);

    // 3. Wait for the required Journal checks on the pull request, which also tests check and
    //    check-post.
    const prSha = gh.prHeadSha(repo, prNumber);
    await pollUntil(
      `PR #${prNumber} Journal checks`,
      () => checkOutcome(gh.checkRunsForCommit(repo, prSha), 'Journal checks'),
      { sleep, log },
      { ...POLL, settled: settled(prSha) },
    );

    // 4. Merge, which is the push to main under test.
    const mergeSha = gh.mergePr(repo, prNumber);
    log(`merged PR #${prNumber} → ${mergeSha}`);

    // The pin is written by the upgrade under test, so check it: a bug there would pass this
    // release while the test repo ran another [R113].
    const pinned = gh.committedEngineVersion(repo);
    if (pinned !== tag) {
      throw new Error(
        `the test repo pins ${pinned ?? 'no engine version'} after the merge, not ${tag}`,
      );
    }
    log(`test repo pinned to ${pinned}`);

    // 5. Paper CI (build and Pages deploy) succeeded on the merge commit.
    await pollUntil(
      'Paper CI (push→main)',
      () =>
        runOutcome(
          gh.workflowRunsForCommit(repo, mergeSha),
          (r) => r.name === 'Paper CI' && r.event === 'push',
          'Paper CI',
        ),
      { sleep, log },
    );

    // 6. Pages serves the site, beyond the deploy job passing.
    const pagesUrl = pagesUrlFor(repo);
    await assertServes200({ probe, sleep }, pagesUrl, 'Pages');
    log(`Pages 200: ${pagesUrl}`);

    // 7. The Journal checks Check Run was posted on main, so check-post ran.
    await pollUntil(
      'Journal checks Check Run (push→main)',
      () => checkOutcome(gh.checkRunsForCommit(repo, mergeSha), 'Journal checks'),
      { sleep, log },
      { ...POLL, settled: settled(mergeSha) },
    );

    log(`push→main CERTIFIED for ${tag}`);

    // ---- A same-repo pull request: Cloudflare preview and comment ----
    phase = 'preview-same-repo';
    const branch = `${CERT_BRANCH_PREFIX}${runId}`;
    const previewPr = gh.openPreviewPr(repo, branch, runId);
    gh.labelPr(repo, previewPr.number, CONFORMANCE_LABEL);
    log(`same-repo preview PR #${previewPr.number} (${branch})`);

    // The `pull_request` job: Paper CI builds without secrets.
    await pollUntil(
      `Paper CI (PR #${previewPr.number} build)`,
      () =>
        runOutcome(
          gh.workflowRunsForCommit(repo, previewPr.headSha),
          (r) => r.name === 'Paper CI' && r.event === 'pull_request',
          'Paper CI (PR)',
        ),
      { sleep, log },
    );

    // The `workflow_run` job: the preview comment. That it exists shows the build and the
    // deploy, split across the two jobs, both ran.
    const previewBody = await pollUntil(
      `preview sticky comment on PR #${previewPr.number}`,
      () =>
        gh.listIssueComments(repo, previewPr.number).find((b) => b.includes(PREVIEW_STICKY_MARK)) ??
        null,
      { sleep, log },
      { ...POLL, settled: settled(previewPr.headSha) },
    );

    // The preview serves 200, beyond the comment existing.
    const previewUrl = extractPreviewUrl(previewBody);
    if (!previewUrl)
      throw new Error(
        'preview comment posted but carries no Cloudflare URL; degraded to artifact (test repo Cloudflare secrets missing?)',
      );
    await assertServes200({ probe, sleep }, previewUrl, 'preview');
    log(`preview 200: ${previewUrl}`);

    // Close this pull request and delete its branch; `reset` does it too after a crash.
    gh.closePr(repo, previewPr.number);
    gh.deleteBranch(repo, branch);
    log(`same-repo preview CERTIFIED for ${tag}`);

    // ---- The deposit: publish.yml and `oak release` ----
    // The tag push, the publish run, and the five deposit files on the tag's release [R24].
    // Reserving a DOI is not tested: the test repo already has a sandbox DOI and `oak
    // deposit prepare` refuses when one is set. This holds no Zenodo token, so it checks the
    // deposit by the release's file names.
    phase = 'deposit';

    // 1. The test repo's myst.yml must carry a sandbox DOI (10.5072/...).
    const doi = gh.committedDoi(repo);
    if (!doi || !doi.startsWith('10.5072/')) {
      throw new Error(
        `the deposit test needs a committed sandbox DOI on the test repo (found ${doi ?? 'none'}); ` +
          `prepare-from-scratch coverage is deferred.`,
      );
    }
    log(`test repo sandbox DOI: ${doi}`);

    // 2. Push the deposit tag at main's head. Delete a stale one first (after a crash), so the
    //    push and the release creation start clean.
    const depositTag = CERT_DEPOSIT_TAG;
    gh.deleteRelease(repo, depositTag); // --cleanup-tag also drops the tag; tolerant of absence
    gh.deleteTag(repo, depositTag); // belt-and-suspenders if a bare tag (no Release) lingered
    const tagSha = gh.defaultBranchSha(repo);
    gh.pushTag(repo, depositTag, tagSha);
    log(`pushed deposit tag ${depositTag} → ${tagSha}`);

    // 3. Wait for the publish run for the tag to succeed.
    await pollUntil(
      `Publish Zenodo deposit success for ${depositTag}`,
      () =>
        runOutcome(
          gh.workflowRunsForCommit(repo, tagSha),
          (r) => r.name === 'Publish Zenodo deposit' && r.event === 'push',
          'Publish Zenodo deposit',
        ),
      { sleep, log },
    );

    // 4. All five deposit files are on the tag's release. Without a Zenodo token this checks
    //    names, not contents [R24].
    const releaseAssets = gh.releaseAssets(repo, depositTag);
    const missing = RESERVED_BUNDLE_NAMES.filter((n) => !releaseAssets.includes(n));
    if (missing.length) {
      throw new Error(
        `GH Release ${depositTag} is missing deposit asset(s): ${missing.join(', ')} ` +
          `(found: ${releaseAssets.join(', ') || 'none'})`,
      );
    }
    log(`deposit bundle on Release ${depositTag}: ${releaseAssets.join(', ')}`);

    // 5. On success, delete the release and with it the tag.
    gh.deleteRelease(repo, depositTag);
    gh.deleteTag(repo, depositTag); // tolerated no-op if the Release cleanup already removed it
    log(`deposit CERTIFIED for ${tag}`);

    // ---- A pull request from a fork (optional) ----
    // The pull request comes from a fork owned by a second account, so the `pull_request` job
    // builds without secrets and the `workflow_run` job deploys from the test repo. Skipped
    // when no fork is set up. Calls on the fork use its token, the rest the main one.
    if (fork) {
      phase = 'preview-fork';
      gh.sweepForkBranches(fork.repo, fork.token, CERT_BRANCH_PREFIX); // idempotency
      const forkBranch = `${CERT_BRANCH_PREFIX}${runId}`;
      const forkPr = gh.openForkPr(repo, fork.repo, fork.token, forkBranch, tag, runId);
      gh.labelPr(repo, forkPr.number, CONFORMANCE_LABEL);
      log(`fork PR #${forkPr.number} from ${fork.repo}:${forkBranch}`);

      // The fork's Paper CI run may wait for first-time-contributor approval: find it and
      // approve it (nothing happens when no approval is needed).
      const forkRun = await pollUntil(
        `fork PR #${forkPr.number} Paper CI run`,
        () =>
          gh
            .workflowRunsForCommit(repo, forkPr.headSha)
            .find((r) => r.name === 'Paper CI' && r.event === 'pull_request') ?? null,
        { sleep, log },
      );
      gh.approveWorkflowRun(repo, forkRun.id);

      // The `pull_request` job: the build without secrets succeeds.
      await pollUntil(
        `fork Paper CI (secretless Stage-1) #${forkPr.number}`,
        () =>
          runOutcome(
            gh.workflowRunsForCommit(repo, forkPr.headSha),
            (r) => r.name === 'Paper CI' && r.event === 'pull_request',
            'fork Paper CI',
          ),
        { sleep, log },
      );

      // The `workflow_run` job: the preview comment and a live 200.
      const forkBody = await pollUntil(
        `fork preview sticky on PR #${forkPr.number}`,
        () =>
          gh.listIssueComments(repo, forkPr.number).find((b) => b.includes(PREVIEW_STICKY_MARK)) ??
          null,
        { sleep, log },
        { ...POLL, settled: settled(forkPr.headSha) },
      );
      const forkPreviewUrl = extractPreviewUrl(forkBody);
      if (!forkPreviewUrl)
        throw new Error('fork preview comment carries no Cloudflare URL; degraded to artifact?');
      await assertServes200({ probe, sleep }, forkPreviewUrl, 'fork preview');
      log(`fork preview 200: ${forkPreviewUrl}`);

      gh.closePr(repo, forkPr.number); // base repo (primary token)
      gh.deleteForkBranch(fork.repo, fork.token, forkBranch); // fork repo (fork token)
      log(`fork preview CERTIFIED for ${tag}`);
      paths.push('preview-fork');
      forkResult = { forkPr: forkPr.number, forkPreviewUrl };
    } else {
      // In the result, not only the log: passing three paths must not read the same as passing
      // four [R113].
      skipped.push('preview-fork');
      log(
        'fork preview phase SKIPPED (no fork configured; set CONFORMANCE_FORK_REPO/PAT to enable)',
      );
    }

    log(`engine ${tag}: paper-CI CERTIFIED (${paths.join(', ')})`);
    return {
      exitCode: 0,
      result: {
        status: 'ok',
        tag,
        repo,
        paths,
        skipped,
        prNumber,
        mergeSha,
        pagesUrl,
        previewPr: previewPr.number,
        previewUrl,
        depositTag,
        releaseAssets,
        ...forkResult,
      },
    };
  } catch (err) {
    // A `ThirdPartyError` (an outage or timeout) is inconclusive (exit 3), never a failure;
    // anything else is a failure (exit 1).
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ThirdPartyError || isGitHubApiFault(err)) {
      log(`engine ${tag}: paper-CI INCONCLUSIVE at ${phase}: ${message}`);
      return {
        exitCode: 3, // 3, not 2: 2 is the CLI's usage code ([R111])
        result: { status: 'inconclusive', tag, path: phase, repo, reason: message },
      };
    }
    log(`engine ${tag}: paper-CI FAILED at ${phase}: ${message}`);
    return { exitCode: 1, result: { status: 'failed', tag, path: phase, repo, failure: message } };
  } finally {
    // Always clean up. Guarded, so a cleanup error never hides the result; the run logs and URLs
    // stay for debugging.
    try {
      await cmdConformanceReset({ repo }, { gh, log });
    } catch (e) {
      log(`teardown warning: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
