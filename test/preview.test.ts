/**
 * deploy-preview, with fakes for Cloudflare, git and gh: a failed Cloudflare deploy falls back
 * to an artifact link [R16], `.pr-number` is removed before serving [R26], and Cloudflare
 * settings come from journal.yml [R27]. Stage 1 builds a pull request with no secrets; Stage 2
 * acts on its result from the base branch (docs/design/paper-ci.md).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takePrNumber } from '../src/artifact.js';
import {
  stripPagesControlFiles,
  previewBranch,
  planPreview,
  previewComment,
  artifactComment,
  loadJournalPreview,
  cmdDeployPreview,
  STICKY_PREVIEW,
  type PagesDeployer,
  type GhPr,
} from '../src/preview.js';
import { JournalConfig } from '../src/schema.js';

/* --------------------------------------------------------------------------
 * Fakes
 * ------------------------------------------------------------------------ */

interface Sticky {
  header: string;
  body: string;
}
function fakeGh(over: Partial<GhPr> = {}): {
  gh: GhPr;
  stickies: Sticky[];
} {
  const stickies: Sticky[] = [];
  const gh: GhPr = {
    sticky(_root, _pr, header, body) {
      stickies.push({ header, body });
    },
    prHead() {
      return HEAD;
    },
    ...over,
  };
  return { gh, stickies };
}

/** The commit Stage 1 built, and the head of every pull request {@link fakeGh} knows. */
const HEAD = 'a'.repeat(40);

const okDeployer = (url = 'https://paper-repo-7.pages.dev'): PagesDeployer => ({
  async deploy() {
    return url;
  },
});
const failDeployer = (msg = 'CF 500'): PagesDeployer => ({
  async deploy() {
    throw new Error(msg);
  },
});

const previewCfg = (over: Record<string, unknown> = {}) =>
  JournalConfig.parse({
    name: 'x',
    preview: { provider: 'cloudflare', cf_project_name: 'journal-x', ...over },
  }).preview;

function siteWithPr(pr: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'oak-preview-'));
  if (pr !== null) writeFileSync(join(dir, '.pr-number'), pr + '\n');
  return dir;
}

/* --------------------------------------------------------------------------
 * Pure logic
 * ------------------------------------------------------------------------ */

describe('takePrNumber', () => {
  it('reads and deletes .pr-number [R26]', () => {
    const dir = siteWithPr('42');
    expect(takePrNumber(dir)).toBe('42');
    expect(existsSync(join(dir, '.pr-number'))).toBe(false); // stripped before serving
  });
  it('returns null when absent', () => {
    expect(takePrNumber(siteWithPr(null))).toBeNull();
  });
  it('treats a blank file as null', () => {
    expect(takePrNumber(siteWithPr('   '))).toBeNull();
  });

  it('refuses a value that is not a pull request number [R136]', () => {
    // The file comes from the `pull_request` job's artifact, which runs the fork's code.
    for (const hostile of ['1/comments?x=', '../../../user/repos', '1 2', 'abc']) {
      expect(() => takePrNumber(siteWithPr(hostile))).toThrow(/not a pull request number/);
    }
  });

  it('still deletes a refused file, so it cannot be served [R26]', () => {
    const dir = siteWithPr('../../etc');
    expect(() => takePrNumber(dir)).toThrow();
    expect(existsSync(join(dir, '.pr-number'))).toBe(false);
  });
});

describe('stripPagesControlFiles removes what would make a static upload run code [R154]', () => {
  it('removes a fork-planted _worker.js', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-strip-'));
    writeFileSync(
      join(dir, '_worker.js'),
      'export default { fetch(){ return new Response("x") } }',
    );
    writeFileSync(join(dir, 'index.html'), '<h1>ok</h1>');
    const removed = stripPagesControlFiles(dir);
    expect(removed).toContain('_worker.js');
    expect(existsSync(join(dir, '_worker.js'))).toBe(false);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });

  it('removes the redirect/header/routes files and a functions dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-strip-'));
    writeFileSync(join(dir, '_redirects'), '/* https://evil.example 302');
    writeFileSync(join(dir, '_headers'), '/*\n  Set-Cookie: x');
    writeFileSync(join(dir, '_routes.json'), '{}');
    mkdirSync(join(dir, 'functions'));
    writeFileSync(join(dir, 'functions', 'index.js'), 'export function onRequest(){}');
    const removed = stripPagesControlFiles(dir);
    expect(removed.sort()).toEqual(['_headers', '_redirects', '_routes.json', 'functions']);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('is a no-op on a clean static build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-strip-'));
    writeFileSync(join(dir, 'index.html'), 'ok');
    expect(stripPagesControlFiles(dir)).toEqual([]);
  });
});

describe('previewBranch keeps the pull request number [R139]', () => {
  const P = 'paper-{repo}-{pr}';
  const long = 'o/lastname-2026-a-long-paper-name';

  it('keeps the pull request number with a long paper name', () => {
    // Every paper in a journal shares one Pages project, so the alias, with {pr} in it, is what
    // keeps each pull request's preview apart.
    expect(previewBranch(P, long, '5')).toMatch(/-5$/);
    expect(previewBranch(P, long, '12')).toMatch(/-12$/);
    expect(previewBranch(P, long, '5')).not.toBe(previewBranch(P, long, '12'));
  });

  it('keeps two long names apart once truncated', () => {
    const a = previewBranch(P, 'o/lastname-2026-brainwide-intrinsic-timescales', '7');
    const b = previewBranch(P, 'o/lastname-2026-brainwide-something-entirely-else', '7');
    expect(a).not.toBe(b);
  });

  it('stays within the Cloudflare alias limit', () => {
    for (const pr of ['1', '12', '123456']) {
      expect(previewBranch(P, long, pr).length).toBeLessThanOrEqual(28);
    }
  });

  it('leaves a name that already fits unchanged', () => {
    expect(previewBranch(P, 'o/smith-2026-pd', '12')).toBe('paper-smith-2026-pd-12');
  });
});

describe('previewBranch', () => {
  it('substitutes {repo}/{pr} and uses the short repo name', () => {
    expect(previewBranch('paper-{repo}-{pr}', 'o/smith-2026-pd', '9')).toBe(
      'paper-smith-2026-pd-9',
    );
  });
  it('makes a Cloudflare-safe alias and shortens it', () => {
    const b = previewBranch('{repo}_{pr}', 'Owner/Weird Name!!', '3');
    expect(b).toMatch(/^[a-z0-9-]+$/);
    expect(b.length).toBeLessThanOrEqual(28);
    expect(b.endsWith('-')).toBe(false);
  });
});

describe('planPreview', () => {
  const cf = { apiToken: 't', accountId: 'a' };
  it('deploys to cloudflare when provider + secrets + project name are all present', () => {
    const plan = planPreview({ preview: previewCfg(), cf, repo: 'o/r', pr: '5' });
    expect(plan).toMatchObject({
      mode: 'cloudflare',
      projectName: 'journal-x',
      branch: 'paper-r-5',
    });
  });
  it('falls back when the provider is not cloudflare', () => {
    const plan = planPreview({
      preview: previewCfg({ provider: 'artifact' }),
      cf,
      repo: 'o/r',
      pr: '5',
    });
    expect(plan).toMatchObject({ mode: 'artifact' });
  });
  it('falls back without the secrets [R6]', () => {
    const plan = planPreview({ preview: previewCfg(), cf: {}, repo: 'o/r', pr: '5' });
    expect(plan).toMatchObject({ mode: 'artifact', reason: expect.stringContaining('secrets') });
  });
  it('falls back when cf_project_name is unset', () => {
    const plan = planPreview({
      preview: previewCfg({ cf_project_name: undefined }),
      cf,
      repo: 'o/r',
      pr: '5',
    });
    expect(plan).toMatchObject({
      mode: 'artifact',
      reason: expect.stringContaining('cf_project_name'),
    });
  });
});

describe('comment bodies', () => {
  it('the preview comment has the marker and the URL', () => {
    const b = previewComment('https://x.pages.dev');
    expect(b).toContain(`oak-sticky: ${STICKY_PREVIEW}`);
    expect(b).toContain('https://x.pages.dev');
  });
  it('the artifact comment has the marker, the run URL and the reason', () => {
    const b = artifactComment('https://gh/o/r/actions', 'no secrets');
    expect(b).toContain(`oak-sticky: ${STICKY_PREVIEW}`);
    expect(b).toContain('https://gh/o/r/actions');
    expect(b).toContain('no secrets');
  });
});

describe('a broken journal.yml [R140]', () => {
  const inst = (body: string) => {
    const d = mkdtempSync(join(tmpdir(), 'oak-inst-'));
    writeFileSync(join(d, 'journal.yml'), body);
    return d;
  };

  it('falls back instead of throwing', () => {
    for (const body of ['name: J\npreview:\n  provider: nonsense\n', 'name: [unclosed\n']) {
      expect(() => loadJournalPreview(inst(body)), body).not.toThrow();
      expect(loadJournalPreview(inst(body)).preview.provider, body).toBe('artifact');
    }
  });

  it('names the bad key, not a JSON dump', () => {
    // The reason goes into the pull request comment, so it must not be `([)`, a zod message's
    // first line.
    const got = loadJournalPreview(inst('name: J\npreview:\n  provider: nonsense\n'));
    expect(got.problem).toContain('journal.yml');
    expect(got.problem).toContain('preview.provider');
  });

  it('a valid one has no problem', () => {
    expect(loadJournalPreview('test/fixture-instance').problem).toBeUndefined();
  });
});

describe('loadJournalPreview', () => {
  it('returns schema defaults with no instance', () => {
    expect(loadJournalPreview(null).preview.provider).toBe('artifact');
  });
  it('reads the fixture-instance journal.yml (provider: artifact)', () => {
    expect(loadJournalPreview('test/fixture-instance').preview.provider).toBe('artifact');
  });
});

/* --------------------------------------------------------------------------
 * Orchestration: cmdDeployPreview
 * ------------------------------------------------------------------------ */

const baseInput = (siteDir: string, over: Record<string, unknown> = {}) => ({
  siteDir,
  repoRoot: '/repo',
  instanceRoot: null,
  repo: 'o/r',
  serverUrl: 'https://github.com',
  cf: { apiToken: 't', accountId: 'a' },
  verifiedHead: HEAD,
  ...over,
});

describe('cmdDeployPreview', () => {
  it('deploys to cloudflare and posts the preview comment (provider: cloudflare)', async () => {
    const dir = siteWithPr('7');
    const { gh, stickies } = fakeGh();
    const out = await cmdDeployPreview(baseInput(dir, { instanceRoot: instanceCf(dir) }), {
      deployer: okDeployer(),
      gh,
    });
    expect(out.exitCode).toBe(0);
    expect(out.result.preview).toBe('cloudflare');
    expect(stickies.some((s) => s.header === STICKY_PREVIEW && s.body.includes('pages.dev'))).toBe(
      true,
    );
    expect(existsSync(join(dir, '.pr-number'))).toBe(false); // stripped
  });

  it('falls back to an artifact comment when the Cloudflare deploy throws [R16]', async () => {
    const dir = siteWithPr('7');
    const { gh, stickies } = fakeGh();
    const out = await cmdDeployPreview(baseInput(dir, { instanceRoot: instanceCf(dir) }), {
      deployer: failDeployer('boom'),
      gh,
    });
    expect(out.exitCode).toBe(0); // not a failure
    expect(out.result.preview).toBe('artifact');
    const c = stickies.find((s) => s.header === STICKY_PREVIEW)!;
    expect(c.body).toContain('boom');
    expect(c.body).toContain('/actions');
  });

  it('falls back to an artifact comment when the journal repo was not found', async () => {
    const dir = siteWithPr('7');
    const { gh, stickies } = fakeGh();
    const out = await cmdDeployPreview(
      baseInput(dir, { instanceRoot: { problem: 'no journal repo found' } }),
      { deployer: okDeployer(), gh },
    );
    expect(out.exitCode).toBe(0);
    expect(out.result.preview).toBe('artifact');
    expect(stickies.find((s) => s.header === STICKY_PREVIEW)!.body).toContain(
      'no journal repo found',
    );
  });

  it('falls back to an artifact comment without the Cloudflare secrets', async () => {
    const dir = siteWithPr('7');
    const { gh, stickies } = fakeGh();
    const out = await cmdDeployPreview(baseInput(dir, { cf: {} }), { deployer: okDeployer(), gh });
    expect(out.result.preview).toBe('artifact');
    expect(stickies.some((s) => s.header === STICKY_PREVIEW)).toBe(true);
  });

  it('links the fallback comment to its Build paper run (artifactRunId)', async () => {
    const dir = siteWithPr('7');
    const { gh, stickies } = fakeGh();
    await cmdDeployPreview(baseInput(dir, { cf: {}, artifactRunId: '12345' }), {
      deployer: okDeployer(),
      gh,
    });
    const c = stickies.find((s) => s.header === STICKY_PREVIEW)!;
    expect(c.body).toContain('/actions/runs/12345');
  });

  it('removes a fork-planted _worker.js before deploying [R154]', async () => {
    const dir = siteWithPr('7');
    writeFileSync(
      join(dir, '_worker.js'),
      'export default { fetch(){ return new Response("pwn") } }',
    );
    let sawWorker = true;
    const snoop: PagesDeployer = {
      async deploy(opts) {
        sawWorker = existsSync(join(opts.dir, '_worker.js'));
        return 'https://paper-repo-7.pages.dev';
      },
    };
    const { gh } = fakeGh();
    await cmdDeployPreview(baseInput(dir, { instanceRoot: instanceCf(dir) }), {
      deployer: snoop,
      gh,
    });
    expect(sawWorker).toBe(false);
    expect(existsSync(join(dir, '_worker.js'))).toBe(false);
  });

  it('refuses a pull request whose head is not the commit Stage 1 built [R136]', async () => {
    // A fork names a pull request it does not own.
    const dir = siteWithPr('99');
    let deployed = false;
    const spy: PagesDeployer = {
      async deploy() {
        deployed = true;
        return 'https://x.pages.dev';
      },
    };
    const { gh, stickies } = fakeGh({ prHead: () => 'b'.repeat(40) });
    await expect(
      cmdDeployPreview(baseInput(dir, { instanceRoot: instanceCf(dir) }), { deployer: spy, gh }),
    ).rejects.toThrow(/heads at b{40}, not at a{40}/);
    expect(deployed).toBe(false);
    expect(stickies).toHaveLength(0);
    expect(existsSync(join(dir, '.pr-number'))).toBe(false); // still never served
  });

  it('refuses without a commit to compare the pull request head with', async () => {
    const dir = siteWithPr('7');
    const { gh, stickies } = fakeGh();
    await expect(
      cmdDeployPreview(baseInput(dir, { verifiedHead: undefined }), { deployer: okDeployer(), gh }),
    ).rejects.toThrow(/--verified-head/);
    expect(stickies).toHaveLength(0);
  });

  it("takes the paper from the artifact's .paper, and never serves the file", async () => {
    const dir = siteWithPr('7');
    writeFileSync(join(dir, '.paper'), 'papers/one\n');
    const { gh } = fakeGh();
    const out = await cmdDeployPreview(baseInput(dir, { cf: {} }), { deployer: okDeployer(), gh });
    expect(out.result.paper).toBe('papers/one');
    expect(existsSync(join(dir, '.paper'))).toBe(false);
  });

  it('no-ops when there is no .pr-number', async () => {
    const dir = siteWithPr(null);
    const { gh, stickies } = fakeGh();
    const out = await cmdDeployPreview(baseInput(dir), { deployer: okDeployer(), gh });
    expect(out.result.preview).toBe('skipped');
    expect(stickies).toHaveLength(0);
  });
});

// A minimal instance dir with a cloudflare-provider journal.yml.
function instanceCf(near: string): string {
  const dir = mkdtempSync(join(near, '..', 'oak-inst-'));
  writeFileSync(
    join(dir, 'journal.yml'),
    'name: J\npreview:\n  provider: cloudflare\n  cf_project_name: journal-x\n',
  );
  return dir;
}
