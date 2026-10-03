/**
 * `oak conformance`, with a fake `ConformanceGh` (no gh or git). `reset` closes labelled pull
 * requests and deletes `cert-*` branches and `*-cert-*` tags, a second reset changes nothing,
 * and other refs are left alone. `run` is tested phase by phase.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cmdConformanceReset,
  cmdConformanceRun,
  pagesUrlFor,
  CONFORMANCE_LABEL,
  CERT_BRANCH_PREFIX,
  CERT_TAG_MARKER,
  CERT_DEPOSIT_TAG,
  type ConformanceGh,
  type ConformanceDeps,
  type WorkflowRun,
  type CheckRunRef,
} from '../src/conformance.js';
import { RESERVED_BUNDLE_NAMES } from '../src/zenodo.js';
import { UPGRADE_BRANCH_PREFIX } from '../src/upgrade.js';

const REPO = 'me/fixture-paper-repo';

/** An in-memory test repo: labelled pull requests, branches and tags. Behaves like the real
 *  one: listBranches filters by prefix, listTags by marker, and deletes skip what is gone. */
function fakeGh(init: {
  prs?: { number: number; headRef: string; label?: string }[];
  branches?: string[];
  tags?: string[];
}): ConformanceGh & { prs: typeof prs; branches: string[]; tags: string[] } {
  const prs = (init.prs ?? []).map((p) => ({ ...p, open: true }));
  let branches = [...(init.branches ?? [])];
  let tags = [...(init.tags ?? [])];
  return {
    prs,
    get branches() {
      return branches;
    },
    get tags() {
      return tags;
    },
    listOpenPrs(_repo, label) {
      return prs
        .filter((p) => p.open && p.label === label)
        .map((p) => ({ number: p.number, headRef: p.headRef }));
    },
    closePr(_repo, prNumber) {
      const pr = prs.find((p) => p.number === prNumber);
      if (pr) pr.open = false;
    },
    listBranches(_repo, prefix) {
      return branches.filter((b) => b.startsWith(prefix));
    },
    deleteBranch(_repo, branch) {
      branches = branches.filter((b) => b !== branch);
    },
    listTags(_repo, marker) {
      return tags.filter((t) => t.includes(marker));
    },
    deleteTag(_repo, tag) {
      tags = tags.filter((t) => t !== tag);
    },
    deleteRelease(_repo, tag) {
      // As `--cleanup-tag`: deleting the release also deletes the tag.
      tags = tags.filter((t) => t !== tag);
    },
  };
}

const silentDeps = (gh: ConformanceGh) => ({ gh, log: () => {} });

describe('cmdConformanceReset', () => {
  it('closes labelled pull requests, deletes cert-* branches and *-cert-* tags, and leaves the rest', async () => {
    const gh = fakeGh({
      prs: [
        { number: 1, headRef: `${CERT_BRANCH_PREFIX}101`, label: CONFORMANCE_LABEL },
        { number: 2, headRef: 'secondacct:conformance-fork', label: CONFORMANCE_LABEL }, // fork pull request, not a `cert-` branch
        { number: 3, headRef: 'feature/unrelated' }, // no label: an author's pull request, left open
      ],
      branches: [`${CERT_BRANCH_PREFIX}101`, `${CERT_BRANCH_PREFIX}102`, 'main', 'gh-pages'],
      tags: [`v0.0.0${CERT_TAG_MARKER}101`, 'v0.0.1', 'v0.0.2'],
    });

    const out = await cmdConformanceReset({ repo: REPO }, silentDeps(gh));

    expect(out.exitCode).toBe(0);
    expect(out.result).toMatchObject({
      status: 'ok',
      repo: REPO,
      closedPrs: [1, 2],
      deletedBranches: [`${CERT_BRANCH_PREFIX}101`, `${CERT_BRANCH_PREFIX}102`],
      deletedTags: [`v0.0.0${CERT_TAG_MARKER}101`],
      changed: 5,
    });

    // The author's pull request stays open; main, gh-pages and real release tags stay.
    expect(gh.prs.find((p) => p.number === 3)!.open).toBe(true);
    expect(gh.branches).toEqual(['main', 'gh-pages']);
    expect(gh.tags).toEqual(['v0.0.1', 'v0.0.2']);
  });

  it('a second reset changes nothing (changed: 0)', async () => {
    const gh = fakeGh({
      prs: [{ number: 1, headRef: `${CERT_BRANCH_PREFIX}101`, label: CONFORMANCE_LABEL }],
      branches: [`${CERT_BRANCH_PREFIX}101`],
      tags: [`v0.0.0${CERT_TAG_MARKER}101`],
    });

    const first = await cmdConformanceReset({ repo: REPO }, silentDeps(gh));
    expect(first.result.changed).toBe(3); // a pull request, a branch and a tag

    const second = await cmdConformanceReset({ repo: REPO }, silentDeps(gh));
    expect(second.result).toMatchObject({
      closedPrs: [],
      deletedBranches: [],
      deletedTags: [],
      changed: 0,
    });
  });

  it('removes a leftover deposit tag (no -cert- marker) and leaves real release tags', async () => {
    const gh = fakeGh({ tags: [CERT_DEPOSIT_TAG, 'v0.0.1', 'v0.0.2'] });
    const out = await cmdConformanceReset({ repo: REPO }, silentDeps(gh));
    expect(out.result).toMatchObject({ deletedTags: [CERT_DEPOSIT_TAG], changed: 1 });
    expect(gh.tags).toEqual(['v0.0.1', 'v0.0.2']);
  });

  it('reset on an already-clean fixture is a no-op', async () => {
    const gh = fakeGh({ branches: ['main'], tags: ['v0.0.1'] });
    const out = await cmdConformanceReset({ repo: REPO }, silentDeps(gh));
    expect(out.result.changed).toBe(0);
    expect(gh.branches).toEqual(['main']);
    expect(gh.tags).toEqual(['v0.0.1']);
  });
});

/* --------------------------------------------------------------------------
 * cmdConformanceRun
 * ------------------------------------------------------------------------ */

const TAG = 'v0.0.0-dev.9';
// Both events, so the push to main and the pull request build each find a passing Paper CI.
const SUCCESS_CI: WorkflowRun[] = [
  {
    id: 1,
    name: 'Paper CI',
    status: 'completed',
    conclusion: 'success',
    url: 'run-url',
    event: 'push',
  },
  {
    id: 2,
    name: 'Paper CI',
    status: 'completed',
    conclusion: 'success',
    url: 'pr-run-url',
    event: 'pull_request',
  },
];
const SUCCESS_CHECK: CheckRunRef[] = [{ name: 'Journal checks', conclusion: 'success' }];
const PREVIEW_COMMENT =
  '<!-- oak-sticky: oak-preview -->\n**Preview deployed** 🚀\n\nhttps://cert-x.oaktree-sapling-test.pages.dev\n';

/** A fake `ConformanceGh` for `run`. The reset methods do nothing (the test repo starts clean);
 *  the others follow `over`. It records labels, merges, closes, tags, approvals and releases.
 *  The publish run on the deposit tag ('main-sha') is `waiting` on the first poll (for its
 *  reviewer) and `completed`/`success` after, so the passing path approves it. */
function fakeCertGh(
  over: {
    workflowRuns?: (sha: string) => WorkflowRun[];
    checkRuns?: (sha: string) => CheckRunRef[];
    comments?: (pr: number) => string[];
    committedDoi?: () => string | null;
    committedEngineVersion?: () => string | null;
    releaseAssets?: (tag: string) => string[];
  } = {},
): ConformanceGh & {
  labeled: [number, string][];
  merged: number[];
  closed: number[];
  pushedTags: [string, string][];
  approvals: [number, string][];
  deletedReleases: string[];
  resetSweeps: number;
  sweptForkBranches: string[];
  openedForkPr: [string, string][];
  deletedForkBranches: string[];
  approvedRuns: number[];
} {
  const labeled: [number, string][] = [];
  const merged: number[] = [];
  const closed: number[] = [];
  const pushedTags: [string, string][] = [];
  const approvals: [number, string][] = [];
  const deletedReleases: string[] = [];
  const sweptForkBranches: string[] = [];
  const openedForkPr: [string, string][] = []; // [forkRepo, branch]
  const deletedForkBranches: string[] = [];
  const approvedRuns: number[] = [];
  let resetSweeps = 0; // reset() calls listOpenPrs first; counting calls shows cleanup ran
  let publishPolls = 0;
  const defaultWorkflowRuns = (sha: string): WorkflowRun[] => {
    const runs = [...SUCCESS_CI];
    if (sha === 'main-sha') {
      publishPolls += 1;
      runs.push({
        id: 3,
        name: 'Publish Zenodo deposit',
        event: 'push',
        url: 'publish-run-url',
        status: publishPolls === 1 ? 'waiting' : 'completed',
        conclusion: publishPolls === 1 ? null : 'success',
      });
    }
    return runs;
  };
  return {
    labeled,
    merged,
    closed,
    pushedTags,
    approvals,
    deletedReleases,
    sweptForkBranches,
    openedForkPr,
    deletedForkBranches,
    approvedRuns,
    get resetSweeps() {
      return resetSweeps;
    },
    listOpenPrs: () => {
      resetSweeps += 1;
      return [];
    },
    closePr: (_r, n) => closed.push(n),
    listBranches: () => [],
    deleteBranch: () => {},
    listTags: () => [],
    deleteTag: () => {},
    labelPr: (_r, n, l) => labeled.push([n, l]),
    prHeadSha: () => 'pr-head-sha',
    mergePr: (_r, n) => {
      merged.push(n);
      return 'merge-sha';
    },
    workflowRunsForCommit: (_r, sha) => (over.workflowRuns ?? defaultWorkflowRuns)(sha),
    checkRunsForCommit: (_r, sha) => (over.checkRuns ?? (() => SUCCESS_CHECK))(sha),
    openPreviewPr: (_r, _b, _m) => ({ number: 21, headSha: 'preview-head-sha' }),
    listIssueComments: (_r, pr) => (over.comments ?? (() => [PREVIEW_COMMENT]))(pr),
    committedDoi: () => (over.committedDoi ?? (() => '10.5072/zenodo.562233'))(),
    committedEngineVersion: () => (over.committedEngineVersion ?? (() => TAG))(),
    defaultBranchSha: () => 'main-sha',
    pushTag: (_r, tag, sha) => pushedTags.push([tag, sha]),
    approveDeployment: (_r, runId, env) => approvals.push([runId, env]),
    releaseAssets: (_r, tag) => (over.releaseAssets ?? (() => [...RESERVED_BUNDLE_NAMES]))(tag),
    deleteRelease: (_r, tag) => deletedReleases.push(tag),
    sweepForkBranches: (forkRepo, _tok, _prefix) => {
      sweptForkBranches.push(forkRepo);
      return [];
    },
    openForkPr: (_base, forkRepo, _tok, branch, _tag, _marker) => {
      openedForkPr.push([forkRepo, branch]);
      return { number: 31, headSha: 'fork-head-sha' };
    },
    deleteForkBranch: (_forkRepo, _tok, branch) => deletedForkBranches.push(branch),
    approveWorkflowRun: (_r, runId) => approvedRuns.push(runId),
  };
}

const FORK = { repo: 'second/fixture-paper-repo', token: 'fork-tok' };

const runDeps = (
  gh: ConformanceGh,
  over: Partial<Pick<ConformanceDeps, 'probe' | 'installEngine' | 'fork'>> = {},
): ConformanceDeps => ({
  gh,
  log: () => {},
  sleep: async () => {}, // no real waits in tests
  probe: over.probe ?? (async () => 200),
  installEngine:
    over.installEngine ??
    (async () => ({
      upToDate: false,
      prNumber: 7,
      prUrl: 'https://github.com/me/fixture-paper-repo/pull/7',
    })),
  fork: 'fork' in over ? over.fork : null,
});

describe('cmdConformanceRun', () => {
  it('passes the push to main, the same-repo preview, and the deposit', async () => {
    const gh = fakeCertGh();
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG, runId: '42' }, runDeps(gh));

    expect(out.exitCode).toBe(0);
    expect(out.result).toMatchObject({
      status: 'ok',
      paths: ['push-main', 'preview-same-repo', 'deposit'],
      tag: TAG,
      prNumber: 7,
      mergeSha: 'merge-sha',
      pagesUrl: pagesUrlFor(REPO),
      previewPr: 21,
      previewUrl: 'https://cert-x.oaktree-sapling-test.pages.dev',
      depositTag: CERT_DEPOSIT_TAG,
      releaseAssets: RESERVED_BUNDLE_NAMES,
    });
    expect(gh.labeled).toEqual([
      [7, CONFORMANCE_LABEL],
      [21, CONFORMANCE_LABEL],
    ]);
    expect(gh.merged).toEqual([7]); // only the upgrade pull request is merged (the push to main)
    expect(gh.closed).toEqual([21]); // the preview pull request is closed, not merged
    expect(gh.pushedTags).toEqual([[CERT_DEPOSIT_TAG, 'main-sha']]); // the reserved deposit tag
    expect(gh.approvals).toEqual([[3, 'zenodo-publish']]); // approved the waiting deployment
    expect(gh.deletedReleases).toContain(CERT_DEPOSIT_TAG); // removed before the push and after success
    // Without a fork, the fork preview is skipped and no fork method is called.
    expect((out.result.paths as string[]).length).toBe(3);
    expect(out.result).not.toHaveProperty('forkPr');
    expect(gh.openedForkPr).toEqual([]);
    expect(gh.sweptForkBranches).toEqual([]);
    expect(gh.approvedRuns).toEqual([]);
    expect(gh.deletedForkBranches).toEqual([]);
  });

  it('passes the fork preview when a fork is set', async () => {
    const gh = fakeCertGh();
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG, runId: '42' },
      runDeps(gh, { fork: FORK }),
    );

    expect(out.exitCode).toBe(0);
    expect(out.result).toMatchObject({
      status: 'ok',
      paths: ['push-main', 'preview-same-repo', 'deposit', 'preview-fork'],
      forkPr: 31,
      forkPreviewUrl: 'https://cert-x.oaktree-sapling-test.pages.dev',
    });
    expect(gh.sweptForkBranches).toEqual([FORK.repo]);
    expect(gh.openedForkPr).toEqual([[FORK.repo, `${CERT_BRANCH_PREFIX}42`]]);
    expect(gh.approvedRuns).toEqual([2]); // the fork pull request's Paper CI run (SUCCESS_CI pull_request)
    expect(gh.labeled).toContainEqual([31, CONFORMANCE_LABEL]);
    expect(gh.closed).toContain(31); // the fork pull request is closed on the test repo (main token)
    expect(gh.deletedForkBranches).toEqual([`${CERT_BRANCH_PREFIX}42`]);
  });

  it('fails at the fork preview when it fell back to an artifact link', async () => {
    // Only the fork pull request (#31) falls back; the same-repo preview (#21) passes first.
    const gh = fakeCertGh({
      comments: (pr) =>
        pr === 31
          ? [
              '<!-- oak-sticky: oak-preview -->\n**Preview build ready** 📦\nartifact link, no live preview',
            ]
          : [PREVIEW_COMMENT],
    });
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG, runId: '42' },
      runDeps(gh, { fork: FORK }),
    );
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'preview-fork' });
    expect(gh.closed).toContain(21); // the same-repo preview passed (closed) before the fork preview
  });

  it('fails at the fork preview when its Paper CI fails', async () => {
    const gh = fakeCertGh({
      workflowRuns: (sha) => {
        if (sha === 'fork-head-sha') {
          return [
            {
              id: 5,
              name: 'Paper CI',
              status: 'completed',
              conclusion: 'failure',
              url: 'bad-fork-run',
              event: 'pull_request',
            },
          ];
        }
        const runs: WorkflowRun[] = [...SUCCESS_CI];
        if (sha === 'main-sha') {
          runs.push({
            id: 3,
            name: 'Publish Zenodo deposit',
            event: 'push',
            url: 'publish-run-url',
            status: 'completed',
            conclusion: 'success',
          });
        }
        return runs;
      },
    });
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG, runId: '42' },
      runDeps(gh, { fork: FORK }),
    );
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'preview-fork' });
    expect(out.result.failure).toContain('fork Paper CI');
  });

  it('fails without merging when the test repo already pins the release (no upgrade pull request)', async () => {
    const gh = fakeCertGh();
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG },
      runDeps(gh, {
        installEngine: async () => ({ upToDate: true, prNumber: null, prUrl: null }),
      }),
    );
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'install' });
    expect(gh.merged).toEqual([]);
  });

  it('fails when Paper CI fails on main', async () => {
    const gh = fakeCertGh({
      workflowRuns: () => [
        {
          id: 9,
          name: 'Paper CI',
          status: 'completed',
          conclusion: 'failure',
          url: 'bad-run',
          event: 'push',
        },
      ],
    });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'push-main' });
    expect(out.result.failure).toContain('Paper CI');
  });

  it('fails when Pages does not serve 200, even if CI passed', async () => {
    const gh = fakeCertGh();
    // Only the /fixture-paper-repo/ Pages URL gives 404; the pages.dev preview gives 200.
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG },
      runDeps(gh, { probe: async (url) => (url === pagesUrlFor(REPO) ? 404 : 200) }),
    );
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'push-main' });
    expect(out.result.failure).toContain('404');
  });

  it('fails at the preview when the comment fell back to an artifact link (no pages.dev URL)', async () => {
    const gh = fakeCertGh({
      comments: () => [
        '<!-- oak-sticky: oak-preview -->\n**Preview build ready** 📦\nartifact link, no live preview',
      ],
    });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'preview-same-repo' });
    expect(gh.merged).toEqual([7]); // the push to main happened; the preview is what failed
  });

  it('is inconclusive, not failed, when the preview URL keeps answering 5xx', async () => {
    const gh = fakeCertGh();
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG },
      runDeps(gh, { probe: async (url) => (url.includes('pages.dev') ? 503 : 200) }),
    );
    expect(out.exitCode).toBe(3); // inconclusive, not a failure; 3, not 2 [R111]
    expect(out.result).toMatchObject({ status: 'inconclusive', path: 'preview-same-repo' });
    expect(out.result.reason).toContain('503');
  });

  it('is inconclusive when a run never completes', async () => {
    const gh = fakeCertGh({
      workflowRuns: () => [
        {
          id: 9,
          name: 'Paper CI',
          status: 'in_progress',
          conclusion: null,
          url: 'stuck',
          event: 'push',
        },
      ],
    });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(3);
    expect(out.result).toMatchObject({ status: 'inconclusive', path: 'push-main' });
    expect(out.result.reason).toContain('timed out');
  });

  it("a 403 refusing the request is oak's fault, and fails [R150]", async () => {
    // A missing scope or `permissions:` block answers 403, which is oak's fault, not a third
    // party's [R150].
    const gh = fakeCertGh();
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG },
      runDeps(gh, {
        installEngine: () => {
          throw new Error(
            'gh api failed (exit 1): gh: Resource not accessible by integration (HTTP 403)',
          );
        },
      }),
    );
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed' });
  });

  it("a rate limit is still not oak's fault [R113]", async () => {
    const gh = fakeCertGh();
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG },
      runDeps(gh, {
        installEngine: () => {
          throw new Error('gh api failed (exit 1): gh: API rate limit exceeded (HTTP 403)');
        },
      }),
    );
    expect(out.exitCode).toBe(3);
    expect(out.result).toMatchObject({ status: 'inconclusive' });
  });

  it('runs teardown (reset) on both success and failure', async () => {
    const ok = fakeCertGh();
    await cmdConformanceRun({ repo: REPO, tag: TAG, runId: '42' }, runDeps(ok));
    expect(ok.resetSweeps).toBeGreaterThanOrEqual(2); // a reset at the start and the cleanup at the end

    const bad = fakeCertGh({ committedDoi: () => null }); // fails at the deposit
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(bad));
    expect(out.result.status).toBe('failed');
    expect(bad.resetSweeps).toBeGreaterThanOrEqual(2); // cleanup still ran after the failure
  });

  it('fails at the deposit when the test repo has no committed sandbox DOI', async () => {
    const gh = fakeCertGh({ committedDoi: () => null });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'deposit' });
    expect(out.result.failure).toContain('sandbox DOI');
    expect(gh.merged).toEqual([7]); // the push to main and the preview passed; the deposit failed
    expect(gh.pushedTags).toEqual([]); // never tagged; the check before it failed
  });

  it('fails at the deposit when the committed DOI is production, not sandbox', async () => {
    const gh = fakeCertGh({ committedDoi: () => '10.5281/zenodo.999999' });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'deposit' });
    expect(gh.pushedTags).toEqual([]);
  });

  it('fails at the deposit when the GitHub release is missing a deposit file', async () => {
    const gh = fakeCertGh({
      releaseAssets: () => RESERVED_BUNDLE_NAMES.filter((n) => n !== 'engine.zip'),
    });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'deposit' });
    expect(out.result.failure).toContain('engine.zip');
    expect(gh.pushedTags).toHaveLength(1); // the tag was pushed before the failing asset check
    expect(gh.pushedTags[0]![1]).toBe('main-sha');
    expect(gh.approvals).toEqual([[3, 'zenodo-publish']]); // the deployment was approved before the asset check
  });

  it('fails on a result that never appeared, rather than blaming a slow third party', async () => {
    // An absent Check Run and a slow one are the same `null`; the runs having finished is what
    // tells them apart ([R113]).
    const gh = fakeCertGh({ checkRuns: () => [] });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'push-main' });
    expect(String(out.result.failure)).toContain('never appeared');
  });

  it('still reports inconclusive while a run is unfinished', async () => {
    const gh = fakeCertGh({
      checkRuns: () => [],
      workflowRuns: () => SUCCESS_CI.map((r) => ({ ...r, status: 'in_progress' })),
    });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(3);
    expect(out.result).toMatchObject({ status: 'inconclusive' });
  });

  it('blames GitHub for a GitHub API fault, not oak', async () => {
    const gh = fakeCertGh();
    const out = await cmdConformanceRun(
      { repo: REPO, tag: TAG },
      runDeps(gh, {
        installEngine: async () => {
          throw new Error('gh api failed (exit 1): gh: Bad gateway (HTTP 502)');
        },
      }),
    );
    expect(out.exitCode).toBe(3);
    expect(out.result).toMatchObject({ status: 'inconclusive' });
  });

  it('fails when the merged fixture is not pinned to the version under test', async () => {
    const gh = fakeCertGh({ committedEngineVersion: () => 'v0.0.0-dev.8' });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'push-main' });
    expect(String(out.result.failure)).toContain('v0.0.0-dev.8');
  });

  it('names a skipped phase in the result, not only in the log', async () => {
    const withoutFork = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(fakeCertGh()));
    expect(withoutFork.result.skipped).toEqual(['preview-fork']);
    const withFork = await cmdConformanceRun(
      { repo: REPO, tag: TAG },
      runDeps(fakeCertGh(), { fork: FORK }),
    );
    expect(withFork.result.skipped).toEqual([]);
  });

  it('fails at the deposit phase when the publish run concludes failure', async () => {
    const gh = fakeCertGh({
      workflowRuns: (sha) =>
        sha === 'main-sha'
          ? [
              {
                id: 3,
                name: 'Publish Zenodo deposit',
                status: 'completed',
                conclusion: 'failure',
                url: 'bad-publish',
                event: 'push',
              },
            ]
          : SUCCESS_CI,
    });
    const out = await cmdConformanceRun({ repo: REPO, tag: TAG }, runDeps(gh));
    expect(out.exitCode).toBe(1);
    expect(out.result).toMatchObject({ status: 'failed', path: 'deposit' });
    expect(out.result.failure).toContain('Publish Zenodo deposit');
    expect(gh.deletedReleases).toEqual([CERT_DEPOSIT_TAG]); // only the cleanup before the push ran
  });
});

describe('reset sweeps what the run creates ([R117])', () => {
  it('deletes the upgrade branch too, not only cert-*', async () => {
    // The upgrade branch is named after the tag, so leaving it would block a second run of the
    // same tag [R117].
    const branches = ['cert-123', 'oak/upgrade-v0.0.2', 'main'];
    const deleted: string[] = [];
    const out = await cmdConformanceReset(
      { repo: 'o/r' },
      {
        log: () => {},
        gh: {
          listOpenPrs: () => [],
          closePr: () => {},
          listBranches: (_r: string, prefix: string) =>
            branches.filter((b) => b.startsWith(prefix)),
          deleteBranch: (_r: string, b: string) => {
            deleted.push(b);
          },
          listTags: () => [],
          deleteTag: () => {},
          deleteRelease: () => {},
        } as unknown as Parameters<typeof cmdConformanceReset>[1]['gh'],
      },
    );
    expect(deleted).toContain('oak/upgrade-v0.0.2');
    expect(deleted).toContain('cert-123');
    expect(deleted).not.toContain('main');
    expect(out.exitCode).toBe(0);
  });

  it('uses the prefix `oak upgrade` actually opens', () => {
    expect(UPGRADE_BRANCH_PREFIX).toBe('oak/upgrade-');
  });
});

/** The cut script and the conformance workflow have no other test. [R111], [R112]. */
describe('the conformance workflow cannot pass without a result', () => {
  const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

  it("does not use the CLI's usage exit code for a result", () => {
    // `run` with a missing --repo exits 2, the code for any UserError [R111].
    const wf = read('.github/workflows/conformance.yml');
    expect(wf).not.toContain('[ "$CODE" = "1" ] && exit 1 || exit 0');
    expect(wf, 'a missing record must redden the run').toContain('if [ ! -f conformance.json ]');
    expect(wf, 'only a real inconclusive verdict may stay green').toMatch(/^\s*3\)/m);
  });

  it('unstages the release files however the release script exits', () => {
    // Left staged, they would go into the next local commit [R112].
    const cut = read('scripts/cut-engine-release.sh');
    const trap = cut.indexOf('trap ');
    const add = cut.indexOf('git add -f dist/cli.cjs');
    expect(trap, 'no trap; an interrupted cut leaves them staged').toBeGreaterThan(-1);
    expect(trap).toBeLessThan(add);
  });

  it('does not leave a pushed tag without its release', () => {
    // A runnable engine is a release ([R57]); a bare tag also burns the version ([R112]).
    const cut = read('scripts/cut-engine-release.sh');
    expect(cut).toMatch(/if ! gh release create/);
    expect(cut, 'the tag must be removed when the release does not follow').toContain(
      'git push origin --delete',
    );
  });

  it('typechecks before cutting', () => {
    // esbuild strips types, so `npm test` does not typecheck. Comments are removed first, so a
    // commented-out line does not count.
    const code = read('scripts/cut-engine-release.sh')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(code).toContain('npm run typecheck');
  });

  it('fails the fixture build when no PDF is produced', () => {
    // A build that passes without a PDF fails [R67].
    const f = read('scripts/build-fixture.mjs');
    expect(f).toMatch(/if \(!pdf\)[\s\S]*process\.exit\(1\)/);
  });
});

describe('RELEASING.md matches the scripts it describes [R115]', () => {
  const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

  it('prunes by tag, not by the listing’s first column', () => {
    // `gh release list`'s first column is the title, which only matches the tag while
    // releases are titled after their tags.
    const doc = read('RELEASING.md');
    expect(doc).toContain('--json tagName,isPrerelease');
    expect(doc).not.toContain('{print $1}');
  });

  it('names every path the published package actually ships', () => {
    const files = (JSON.parse(read('package.json')) as { files: string[] }).files;
    const npmSection = read('RELEASING.md').split('## The npm package')[1] ?? '';
    // The code spans as a set: `ci/` is a substring of `ci/run.sh`, so a `toContain` over the
    // text would pass for a narrower path than the one in `files` [R115].
    const spans = new Set([...npmSection.matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
    for (const entry of files) expect([...spans], `files entry ${entry}`).toContain(entry);
  });

  it('fetches the pinned typst before the fixture build that uses it', () => {
    // Comments are removed first, since they quote both commands.
    const lines = read('scripts/cut-engine-release.sh')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'));
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at('releases/download')).toBeGreaterThan(-1);
    expect(at('releases/download')).toBeLessThan(at('npm test'));
  });
});
