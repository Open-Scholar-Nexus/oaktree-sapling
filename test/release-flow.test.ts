/**
 * `oak release --repo owner/paper vX` from the terminal (`runRelease`), with a fake GitHub
 * and Zenodo: each run reads where the release stands and does what is left, refusals come
 * before anything changes, and the DOI pull request is merged only at the commit pushed in the
 * same run.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runRelease,
  BUILD_WAIT,
  DEPOSIT_WORKFLOW_PATH,
  DEPOSITED_ASSET,
  RUN_WAIT,
  type CiJob,
  type ReleaseDeps,
  type ReleaseInput,
  type ReleaseSource,
} from '../src/release.js';
import type { DepositState } from '../src/zenodo.js';
import { UserError } from '../src/messages.js';

const REPO = 'o/paper';
const TAG = 'v1.0.0';
const PROD_DOI = '10.5281/zenodo.100';
const SANDBOX_DOI = '10.5072/zenodo.100';
const MAIN = 'a'.repeat(40);
const DOI_COMMIT = 'b'.repeat(40);
const MERGE = 'c'.repeat(40);
const LATER = 'd'.repeat(40);
const OLD_DOI_COMMIT = 'e'.repeat(40);
const PR_URL = 'https://github.com/o/paper/pull/9';
const RUN_URL = 'https://github.com/o/paper/actions/runs/7';

const myst = (doi?: string) =>
  `version: 1\nproject:\n  title: Paper\n${doi ? `  doi: ${doi}\n` : ''}`;

/** GitHub and Zenodo as a run finds them; each test sets where the release stands. */
interface World {
  head: { sha: string; subject: string };
  files: Record<string, string>;
  tags: Record<string, string>;
  pr: { number: number; url: string } | null;
  allowMerge: boolean;
  mergeRefused: boolean;
  /** A commit someone pushes to main right after the merge. */
  pushAfterMerge: string | null;
  /** Polls before the Deposit version run shows up once the tag exists. */
  runAfter: number;
  /** The build's jobs on each poll; the last repeats. */
  jobSteps: CiJob[][];
  assets: string[];
  /** Assets the CI deposit attaches by the time the build is done. */
  ciAttaches: boolean;
  zenodo: DepositState;
  token: boolean;
}

const built: CiJob[] = [
  { name: 'build', status: 'completed', conclusion: 'success', completedAt: 'x' },
  { name: 'publish', status: 'completed', conclusion: 'success', completedAt: 'x' },
];

function world(over: Partial<World> = {}): World {
  return {
    head: { sha: MAIN, subject: 'Fix figure 2' },
    files: { [MAIN]: myst() },
    tags: {},
    pr: null,
    allowMerge: true,
    mergeRefused: false,
    pushAfterMerge: null,
    runAfter: 0,
    jobSteps: [built],
    assets: [],
    ciAttaches: false,
    zenodo: { kind: 'draft' },
    token: true,
    ...over,
  };
}

/** The fake, recording each call that changes something, in order. */
function harness(w: World, input: Partial<ReleaseInput> = {}) {
  const outward: string[] = [];
  const logs: string[] = [];
  const plans: string[][] = [];
  let clone = '';
  let polls = 0;
  let jobPolls = 0;
  let pushed: string | null = null;
  let checkedOut: string | null = null;
  const src: ReleaseSource = {
    vTags: () => Object.keys(w.tags),
    clone: () => (clone = mkdtempSync(join(tmpdir(), 'oak-release-test-'))),
    fetch: () => {},
    head: () => w.head,
    tagCommit: (_c, tag) => w.tags[tag] ?? null,
    fileAt: (_c, ref) => w.files[ref] ?? null,
    checkout: (_c, ref) => {
      checkedOut = ref;
      outward.push(`checkout ${ref}`);
    },
    pushedHead: () => pushed,
    openPr: () => w.pr,
    markChecksSkipped: (_r, sha) => void outward.push(`status ${sha}`),
    allowsMergeCommit: () => w.allowMerge,
    merge: (_r, pr, sha, method) => {
      outward.push(`merge #${pr} ${sha} --${method}`);
      if (w.mergeRefused) throw new Error('gh pr merge failed: head branch was modified');
      w.files[MERGE] = w.files[sha]!;
      w.head = { sha: w.pushAfterMerge ?? MERGE, subject: 'Merge' };
      if (w.pushAfterMerge) w.files[w.pushAfterMerge] = w.files[sha]!;
      return MERGE;
    },
    createTag: (_r, tag, sha) => {
      outward.push(`tag ${tag} ${sha}`);
      w.tags[tag] = sha;
    },
    commitsBetween: (_c, from, to) => [`${to.slice(0, 7)} after ${from.slice(0, 7)}`],
    releaseAssets: () => (w.ciAttaches && jobPolls > 0 ? [DEPOSITED_ASSET] : w.assets),
    pushRuns: (_r, sha) =>
      w.tags[TAG] === sha && polls++ >= w.runAfter
        ? [
            {
              id: 7,
              path: DEPOSIT_WORKFLOW_PATH,
              event: 'push',
              headBranch: TAG,
              headSha: sha,
              url: RUN_URL,
            },
          ]
        : [],
    jobs: () => w.jobSteps[Math.min(jobPolls++, w.jobSteps.length - 1)]!,
  };
  const deps: ReleaseDeps = {
    src,
    hasToken: () => w.token,
    readDepositState: async () => w.zenodo,
    checkPin: () => {},
    reserveDoi: async () => {
      outward.push('prepare');
      pushed = DOI_COMMIT;
      w.files[DOI_COMMIT] = myst(input.sandbox ? SANDBOX_DOI : PROD_DOI);
      w.pr = { number: 9, url: PR_URL };
      return 0;
    },
    deposit: async (dir) => {
      expect(dir).toBe(clone);
      outward.push(`deposit at ${checkedOut}`);
      return 0;
    },
    confirm: async (plan) => {
      plans.push(plan);
      return true;
    },
    sleep: async () => {},
    log: (line) => void logs.push(line),
  };
  const outcome = () =>
    runRelease(
      { repo: REPO, tag: TAG, sandbox: false, publish: false, rerun: 'oak release …', ...input },
      deps,
    );
  const run = async () => (await outcome()).code;
  return { run, outcome, deps, outward, logs, plans, clone: () => clone };
}

describe('oak release from the terminal: a first deposit', () => {
  it('reserves, marks the checks skipped, merges the pushed commit, tags the merge, deposits', async () => {
    const h = harness(world());
    expect(await h.run()).toBe(0);
    expect(h.outward).toEqual([
      'prepare',
      `status ${DOI_COMMIT}`,
      `merge #9 ${DOI_COMMIT} --merge`,
      `tag ${TAG} ${MERGE}`,
      `checkout refs/tags/${TAG}`,
      `deposit at refs/tags/${TAG}`,
    ]);
    expect(h.plans).toHaveLength(1);
    expect(h.plans[0]!.join('\n')).toContain('reserve a DOI on Zenodo (production)');
    expect(h.plans[0]!.join('\n')).toContain('mark its Journal checks as skipped and merge it');
    expect(existsSync(h.clone())).toBe(false);
  });

  it('squashes only when the repo disallows merge commits', async () => {
    const h = harness(world({ allowMerge: false }));
    expect(await h.run()).toBe(0);
    expect(h.outward).toContain(`merge #9 ${DOI_COMMIT} --squash`);
  });

  it('with the DOI pull request open from an earlier run, pushes again and merges the new commit', async () => {
    const w = world({ pr: { number: 9, url: PR_URL } });
    w.files[OLD_DOI_COMMIT] = myst(PROD_DOI);
    const h = harness(w);
    expect(await h.run()).toBe(0);
    expect(h.plans[0]!.join('\n')).toContain("replace the open DOI pull request's commit");
    expect(h.outward.slice(0, 3)).toEqual([
      'prepare',
      `status ${DOI_COMMIT}`,
      `merge #9 ${DOI_COMMIT} --merge`,
    ]);
  });

  it('stops with the pull request link when GitHub refuses the merge, and tags nothing', async () => {
    const h = harness(world({ mergeRefused: true }));
    const err = await h.run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toContain(PR_URL);
    expect(h.outward.some((c) => c.startsWith('tag '))).toBe(false);
    expect(existsSync(h.clone())).toBe(true);
    // After the refusal, which `main` prints from the message.
    expect((err as Error).message).toContain(`rm -rf ${h.clone()}`);
    expect(h.logs.join('\n')).not.toContain('rm -rf');
  });

  it('tags the merge commit when the default branch moved after the merge, and says what is left out', async () => {
    const h = harness(world({ pushAfterMerge: LATER }));
    expect(await h.run()).toBe(0);
    expect(h.outward).toContain(`tag ${TAG} ${MERGE}`);
    expect(h.logs.join('\n')).toContain('these commits are not in this release');
  });

  it('reserves on the sandbox with --sandbox', async () => {
    const h = harness(world(), { sandbox: true });
    expect(await h.run()).toBe(0);
    expect(h.plans[0]!.join('\n')).toContain('reserve a DOI on Zenodo (sandbox)');
  });
});

describe('oak release from the terminal: a rerun continues where the release stands', () => {
  it('merged but untagged: tags the head shown in the confirmation', async () => {
    const h = harness(world({ files: { [MAIN]: myst(PROD_DOI) } }));
    expect(await h.run()).toBe(0);
    expect(h.plans[0]!.join('\n')).toContain(`tag ${TAG} at ${MAIN.slice(0, 7)} "Fix figure 2"`);
    expect(h.outward).toEqual([
      `tag ${TAG} ${MAIN}`,
      `checkout refs/tags/${TAG}`,
      `deposit at refs/tags/${TAG}`,
    ]);
  });

  it('tagged with no run yet: waits for the run, asks nothing', async () => {
    const h = harness(
      world({ files: { [MAIN]: myst(PROD_DOI) }, tags: { [TAG]: MAIN }, runAfter: 3 }),
    );
    expect(await h.run()).toBe(0);
    expect(h.plans).toEqual([]);
    expect(h.outward).toEqual([`checkout refs/tags/${TAG}`, `deposit at refs/tags/${TAG}`]);
  });

  it('build running: prints each state change, then deposits', async () => {
    const h = harness(
      world({
        files: { [MAIN]: myst(PROD_DOI) },
        tags: { [TAG]: MAIN },
        jobSteps: [
          [],
          [{ name: 'build', status: 'in_progress', conclusion: null, completedAt: null }],
          [
            { name: 'build', status: 'completed', conclusion: 'success', completedAt: 'x' },
            { name: 'publish', status: 'in_progress', conclusion: null, completedAt: null },
          ],
          built,
        ],
      }),
    );
    expect(await h.run()).toBe(0);
    const states = h.logs.filter((l) => /queued|in progress|job done/.test(l));
    expect(states).toEqual(
      [
        'Deposit version run queued',
        'build job in progress',
        'build job done; publish job in progress',
        'build job done',
      ].map((s) => `oak release: ${s}: ${RUN_URL}`),
    );
  });

  it('published on Zenodo with this version: hands to the deposit step, which finishes it', async () => {
    const h = harness(
      world({
        files: { [MAIN]: myst(PROD_DOI) },
        tags: { [TAG]: MAIN },
        zenodo: { kind: 'published', version: '1.0.0', recordUrl: 'r' },
      }),
    );
    expect(await h.run()).toBe(0);
    expect(h.outward).toContain(`deposit at refs/tags/${TAG}`);
  });

  it('everything done: changes nothing and needs no token', async () => {
    const h = harness(
      world({
        files: { [MAIN]: myst(PROD_DOI) },
        tags: { [TAG]: MAIN },
        assets: [DEPOSITED_ASSET],
        token: false,
      }),
    );
    expect(await h.run()).toBe(0);
    expect(h.outward).toEqual([]);
    expect(h.logs.join('\n')).toContain('already deposited');
  });

  it('deposited by the Deposit version run: ends after the wait, with no deposit step', async () => {
    const h = harness(
      world({ files: { [MAIN]: myst(PROD_DOI) }, tags: { [TAG]: MAIN }, ciAttaches: true }),
    );
    expect(await h.run()).toBe(0);
    expect(h.outward).toEqual([]);
    expect(h.logs.join('\n')).toContain('already deposited by the Deposit version run');
  });
});

describe('oak release from the terminal: refusals before anything changes', () => {
  const refuses = async (w: World, input: Partial<ReleaseInput> = {}, text?: string) => {
    const h = harness(w, input);
    const err = await h.run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    if (text) expect((err as Error).message).toContain(text);
    expect(h.outward).toEqual([]);
    expect(h.plans).toEqual([]);
    expect(existsSync(h.clone())).toBe(true);
  };

  it('a tag whose myst.yml has no DOI', () =>
    refuses(world({ tags: { [TAG]: MAIN } }), {}, 'tagged before the DOI pull request was merged'));

  it('--sandbox with a production DOI on the default branch', () =>
    refuses(world({ files: { [MAIN]: myst(PROD_DOI) } }), { sandbox: true }, 'Drop --sandbox'));

  it('a later version whose Zenodo draft is missing, before the tag is made', () =>
    refuses(
      world({
        files: { [MAIN]: myst(PROD_DOI) },
        zenodo: { kind: 'published', version: '0.9.0', recordUrl: 'https://zenodo.org/records/9' },
      }),
      {},
      'click New version',
    ));

  it('no record for the committed DOI', () =>
    refuses(world({ files: { [MAIN]: myst(PROD_DOI) }, zenodo: { kind: 'none' } })));

  it('a pinned oak whose steps would refuse, checked at the commit to be tagged', async () => {
    const pinned = `${myst(PROD_DOI)}  options:\n    oaktree-sapling:\n      version: v0.2.0\n`;
    const h = harness(world({ files: { [MAIN]: pinned } }));
    const seen: string[] = [];
    h.deps.checkPin = (version) => {
      seen.push(version);
      throw new UserError('too old');
    };
    await expect(h.run()).rejects.toThrow('too old');
    expect(seen).toEqual(['v0.2.0']);
    expect(h.outward).toEqual([]);
    expect(h.plans).toEqual([]);
  });

  it('no Zenodo token for the environment', () =>
    refuses(world({ token: false }), {}, 'ZENODO_TOKEN'));

  it('the confirmation declined (or no TTY without --yes): exits 0, changes nothing', async () => {
    const h = harness(world());
    h.deps.confirm = async () => false;
    expect(await h.run()).toBe(0);
    expect(h.outward).toEqual([]);
  });
});

describe('oak release from the terminal: the build', () => {
  const tagged = (over: Partial<World>) =>
    world({ files: { [MAIN]: myst(PROD_DOI) }, tags: { [TAG]: MAIN }, ...over });

  it('a failed build stops with its link, and nothing is deposited', async () => {
    const h = harness(
      tagged({
        jobSteps: [
          [{ name: 'build', status: 'completed', conclusion: 'failure', completedAt: 'x' }],
        ],
      }),
    );
    const err = await h.run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toContain(RUN_URL);
    expect(h.outward).toEqual([]);
  });

  it('no run within the limit: exit 3 with the command to rerun, and a line every 5 minutes meanwhile', async () => {
    const h = harness(tagged({ runAfter: RUN_WAIT.tries }));
    expect(await h.run()).toBe(3);
    expect(h.logs.join('\n')).toContain('no Deposit version run started for v1.0.0');
    const heartbeats = h.logs.filter((l) =>
      l.startsWith('oak release: no Deposit version run for'),
    );
    expect(heartbeats).toHaveLength(Math.floor((RUN_WAIT.tries - 1) / 20));
    expect(heartbeats[0]).toContain('https://github.com/');
    expect(h.logs.join('\n')).toContain('rerun the same command to continue: oak release …');
  });

  it('a build still running at the limit: exit 3, with a line every 5 minutes meanwhile', async () => {
    const h = harness(
      tagged({
        jobSteps: [[{ name: 'build', status: 'in_progress', conclusion: null, completedAt: null }]],
      }),
    );
    expect(await h.run()).toBe(3);
    const heartbeats = h.logs.filter((l) => l.startsWith('oak release: still waiting'));
    expect(heartbeats).toHaveLength(Math.floor((BUILD_WAIT.tries - 1) / 20));
  });
});

describe('oak release from the terminal: how it ended', () => {
  const done = { files: { [MAIN]: myst(PROD_DOI) }, tags: { [TAG]: MAIN } };

  it('names the reason with the exit code', async () => {
    expect(await harness(world(done)).outcome()).toEqual({ code: 0, reason: 'deposited' });
    expect(await harness(world({ ...done, assets: [DEPOSITED_ASSET] })).outcome()).toEqual({
      code: 0,
      reason: 'already-deposited',
    });
    expect(await harness(world({ ...done, ciAttaches: true })).outcome()).toEqual({
      code: 0,
      reason: 'deposited-by-ci',
    });
    const declined = harness(world());
    declined.deps.confirm = async () => false;
    expect(await declined.outcome()).toEqual({ code: 0, reason: 'declined' });
    const failed = harness(world(done));
    failed.deps.deposit = async () => 2;
    expect(await failed.outcome()).toEqual({ code: 2, reason: 'step-failed' });
  });
});
