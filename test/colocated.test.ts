/**
 * The co-located tier: many papers in one repository, each in `papers/<id>/`. Discovery, the
 * one-paper rule for fork pull requests, version tags, the draft checks and the registry's folder
 * form.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverProjects,
  folderId,
  forkPaper,
  isColocated,
  PAPER_ID,
  parsePaperTag,
  colocatedPaper,
  paperDirOf,
} from '../src/projects.js';
import { findSelf, runLayerA, runValidate, type FsProbes } from '../src/validate.js';
import { selectPapers } from '../src/papers.js';
import { combineReports, refusedReport, checksComment, type ChecksReport } from '../src/checks.js';
import { underPaths, GATED_PATHS } from '../src/schema.js';
import { previewBranch } from '../src/preview.js';
import type { MystEdge } from '../src/build.js';
import { bundleState, assertBundleNotStale, bundlePath } from './bundle-state.js';

const allTrue: FsProbes = { existsProbe: () => true, listTree: () => [] };

/** A co-located repository: journal settings at the root, pins.yml naming engine_version, and
 *  a folder per paper id. */
function colocatedRepo(papers: string[], registry = '[]\n'): string {
  const root = mkdtempSync(join(tmpdir(), 'oak-colo-'));
  mkdirSync(join(root, '.github', 'actions', 'engine'), { recursive: true });
  writeFileSync(
    join(root, '.github', 'actions', 'engine', 'pins.yml'),
    'engine_repo: me/engine\ninstance_repo: .\nengine_version: v1.0.0\n',
  );
  writeFileSync(
    join(root, 'journal.yml'),
    'name: J\nid_pattern: "^[a-z0-9]+-\\\\d{4}-[a-z0-9-]+$"\n',
  );
  mkdirSync(join(root, 'registry'));
  writeFileSync(join(root, 'registry', 'papers.yml'), registry);
  mkdirSync(join(root, 'papers'));
  for (const id of papers) {
    mkdirSync(join(root, 'papers', id));
    writeFileSync(join(root, 'papers', id, 'myst.yml'), `version: 1\nproject:\n  id: ${id}\n`);
  }
  return root;
}

describe('discoverProjects', () => {
  it('lists papers/*/myst.yml, sorted, when papers/ exists', () => {
    const root = colocatedRepo(['b-2026-two', 'a-2026-one']);
    mkdirSync(join(root, 'papers', 'notes')); // no myst.yml: not a paper
    expect(discoverProjects(root)).toEqual(['papers/a-2026-one', 'papers/b-2026-two']);
    expect(isColocated(root)).toBe(true);
  });

  it('is the paper at the root otherwise', () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-paper-'));
    expect(discoverProjects(root)).toEqual(['.']);
    expect(isColocated(root)).toBe(false);
  });

  it('a paper repository with a papers/ folder of its own stays a paper repository', () => {
    // The tier is read from pins.yml, which editors gate, never from a folder an author adds.
    const root = mkdtempSync(join(tmpdir(), 'oak-paper-'));
    mkdirSync(join(root, '.github', 'actions', 'engine'), { recursive: true });
    writeFileSync(
      join(root, '.github', 'actions', 'engine', 'pins.yml'),
      'engine_repo: me/engine\n',
    );
    mkdirSync(join(root, 'papers', 'related-work'), { recursive: true });
    writeFileSync(join(root, 'papers', 'related-work', 'myst.yml'), 'version: 1\n');
    expect(isColocated(root)).toBe(false);
    expect(discoverProjects(root)).toEqual(['.']);
    const pick = selectPapers(root, { for: 'check', event: 'pull_request' }, () => [
      'papers/related-work/myst.yml',
    ]);
    expect(pick.result.papers).toEqual([{ dir: '.', key: '' }]);
  });

  it('is empty for a co-located repository with no paper yet', () => {
    expect(discoverProjects(colocatedRepo([]))).toEqual([]);
  });

  it('refuses a paper folder not named by a paper id, which could be neither built nor checked', () => {
    for (const bad of ['.hidden', 'has space', '-dash']) {
      const root = colocatedRepo(['a-2026-one']);
      mkdirSync(join(root, 'papers', bad));
      writeFileSync(join(root, 'papers', bad, 'myst.yml'), 'version: 1\n');
      expect(() => discoverProjects(root), bad).toThrow(/not named by a paper id/);
    }
  });

  it('a pins.yml with no instance_repo is a paper repository whose journal is unknown', () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-paper-'));
    mkdirSync(join(root, '.github', 'actions', 'engine'), { recursive: true });
    const pins = join(root, '.github', 'actions', 'engine', 'pins.yml');
    for (const body of [
      'engine_repo: me/engine\n',
      'engine_repo: me/engine\nengine_version: v1.0.0\n',
    ]) {
      writeFileSync(pins, body);
      expect(isColocated(root), body).toBe(false);
    }
    writeFileSync(pins, 'engine_repo: me/engine\ninstance_repo: acme/journal\n');
    expect(isColocated(root)).toBe(false);
    writeFileSync(pins, 'engine_repo: me/engine\ninstance_repo: .\n');
    expect(isColocated(root)).toBe(true);
  });

  it('ignores a folder without a myst.yml and a file', () => {
    const root = colocatedRepo(['a-2026-one']);
    mkdirSync(join(root, 'papers', '.notes'));
    writeFileSync(join(root, 'papers', '.gitkeep'), '');
    expect(discoverProjects(root)).toEqual(['papers/a-2026-one']);
  });
});

describe('PAPER_ID: a folder name is one path segment and a tag prefix', () => {
  it.each([
    ['smith-2026-paper', true],
    ['A_b-1', true],
    ['..', false],
    ['a.b', false],
    ['a/b', false],
    ['-a', false],
    ['a\nb', false],
    ['a b', false],
    ['', false],
    ['$(id)', false],
  ])('%j → %s', (id, ok) => {
    expect(PAPER_ID.test(id)).toBe(ok);
  });

  it('paperDirOf refuses anything else', () => {
    expect(paperDirOf('a-2026-x', '--paper')).toBe('papers/a-2026-x');
    expect(() => paperDirOf('../x', 'paper')).toThrow(/paper id/);
  });

  it('folderId reads papers/<id> only', () => {
    expect(folderId('papers/a-1')).toBe('a-1');
    expect(folderId('.')).toBeNull();
    expect(folderId('papers/a/b')).toBeNull();
    expect(folderId('other/a')).toBeNull();
  });

  it('colocatedPaper is a folder in papers/', () => {
    expect(colocatedPaper('/r/papers/a-1')).toEqual({ dir: 'papers/a-1', id: 'a-1' });
    expect(colocatedPaper('/r')).toBeNull();
  });
});

describe('parsePaperTag: the tag names the paper', () => {
  it('vX.Y.Z is the paper at the root', () => {
    expect(parsePaperTag('v1.2.3')).toEqual({ paperDir: '.', id: null, version: 'v1.2.3' });
  });
  it('<id>/vX.Y.Z is papers/<id>', () => {
    expect(parsePaperTag('a-2026-x/v1.0.0')).toEqual({
      paperDir: 'papers/a-2026-x',
      id: 'a-2026-x',
      version: 'v1.0.0',
    });
  });
  it.each(['v1.0', 'a/b/v1.0.0', '../v1.0.0', 'a/v1.0.0-dev.1', 'a/1.0.0', '/v1.0.0', 'x'])(
    'refuses %j',
    (tag) => expect(parsePaperTag(tag)).toBeNull(),
  );
});

describe('forkPaper: a fork pull request changes one paper folder', () => {
  it('names the one folder', () => {
    expect(forkPaper(['papers/a-1/index.md', 'papers/a-1/figs/x.png'])).toEqual({
      paper: 'papers/a-1',
    });
  });
  it('refuses a second paper, including another paper only', () => {
    const r = forkPaper(['papers/a-1/index.md', 'papers/b-2/index.md']);
    expect('refused' in r && r.refused).toContain('`papers/a-1`, `papers/b-2`');
  });
  it('refuses a file outside papers/, settings and launchers included', () => {
    for (const f of ['journal.yml', '.github/workflows/build-paper.yml', 'CODEOWNERS', 'papers']) {
      const r = forkPaper(['papers/a-1/index.md', f]);
      expect('refused' in r && r.refused, f).toContain(f);
    }
  });
  it('refuses a list GitHub could not give in full, and an empty one', () => {
    expect('refused' in forkPaper(null)).toBe(true);
    expect('refused' in forkPaper([])).toBe(true);
  });
  it('refuses a folder that is not a paper id', () => {
    expect('refused' in forkPaper(['papers/../x/index.md'])).toBe(true);
  });
});

describe('the gated paths cover each co-located paper environment', () => {
  it('papers/<id>/paper-environment.yml is gated, one segment deep', () => {
    expect(underPaths(GATED_PATHS, 'papers/a-1/paper-environment.yml')).toBe(true);
    expect(underPaths(GATED_PATHS, 'paper-environment.yml')).toBe(true);
    expect(underPaths(GATED_PATHS, 'papers/a-1/index.md')).toBe(false);
    expect(underPaths(GATED_PATHS, 'papers/a/b/paper-environment.yml')).toBe(false);
  });
});

describe('previewBranch gains the paper id', () => {
  const P = 'paper-{repo}-{pr}';
  it('gives each paper of one pull request its own branch, within the limit', () => {
    const a = previewBranch(P, 'acme/journal', '7', 'smith-2026-a-long-paper-title');
    const b = previewBranch(P, 'acme/journal', '7', 'smith-2026-a-long-paper-other');
    expect(a).not.toBe(b);
    for (const x of [a, b]) {
      expect(x.length).toBeLessThanOrEqual(28);
      expect(x).toMatch(/-7$/);
    }
  });
  it('leaves the paper at the root as it was', () => {
    expect(previewBranch(P, 'o/geetha-2026-pd', '12')).toBe('paper-geetha-2026-pd-12');
  });
});

describe('findSelf: the folder form of a registry location', () => {
  it("matches a './papers/<id>' entry to that folder", () => {
    const root = colocatedRepo(['a-2026-one']);
    const entries = [
      { id: 'a-2026-one', location: './papers/a-2026-one' },
      { id: 'b-2026-two', location: './papers/b-2026-two' },
      { id: 'c-2026-three', location: 'acme/journal' },
    ];
    const paperRoot = join(root, 'papers', 'a-2026-one');
    expect(findSelf(entries, 'acme/journal', { instanceRoot: root, paperRoot })).toEqual([
      entries[0],
    ]);
  });
});

describe('runLayerA on a co-located paper', () => {
  const run = (registry: string, folder: string, id: string) => {
    const root = colocatedRepo([folder], registry);
    return runLayerA(
      {
        paperRoot: join(root, 'papers', folder),
        instanceRoot: root,
        project: { id },
        repo: 'acme/journal',
      },
      allTrue,
    );
  };
  const identity = (f: ReturnType<typeof run>) =>
    f.filter((x) => x.klass === 'identity' && x.severity === 'error').map((x) => x.check);

  it('passes a listed paper whose folder is its id', () => {
    expect(
      identity(
        run('- id: a-2026-one\n  location: ./papers/a-2026-one\n', 'a-2026-one', 'a-2026-one'),
      ),
    ).toEqual([]);
  });

  it('passes an unlisted draft', () => {
    expect(identity(run('[]\n', 'a-2026-one', 'a-2026-one'))).toEqual([]);
  });

  it('fails when the folder is not named by the id', () => {
    const f = run('[]\n', 'a-2026-one', 'a-2026-other');
    expect(identity(f)).toEqual(['id-folder']);
    expect(f.find((x) => x.check === 'id-folder')?.message).toContain('papers/a-2026-one');
  });

  it('fails when another entry holds the id', () => {
    expect(
      identity(run('- id: a-2026-one\n  location: acme/elsewhere\n', 'a-2026-one', 'a-2026-one')),
    ).toEqual(['id-uniqueness']);
  });

  it("fails when the folder's own entry carries another id", () => {
    expect(
      identity(
        run('- id: a-2026-old\n  location: ./papers/a-2026-one\n', 'a-2026-one', 'a-2026-one'),
      ),
    ).toEqual(['id-registered']);
  });
});

describe('the draft checks: editorial checks warn until the paper is listed', () => {
  const edge = (checks: unknown[]): MystEdge => ({
    async loadProject() {
      return { id: 'a-2026-one' } as never;
    },
    async build() {},
    async withProjectSession() {
      return checks as never;
    },
  });
  const failing = [{ id: 'abstract-exists', status: 'fail', message: 'no abstract' }];

  async function validateIn(registry: string, id = 'a-2026-one') {
    const root = colocatedRepo(['a-2026-one'], registry);
    return runValidate(
      { paperRoot: join(root, 'papers', 'a-2026-one'), instanceRoot: root, edge: edge(failing) },
      { repo: 'acme/journal' },
      { existsProbe: (p) => !p.includes('_build'), listTree: () => [] },
    ).then((out) => ({ out, id }));
  }

  it('an unlisted paper passes with the editorial failure as a warning, and says why', async () => {
    const { out } = await validateIn('[]\n');
    expect(out.checks.find((c) => c.id === 'abstract-exists')?.optional).toBe(true);
    expect(out.checkRun.conclusion).toBe('success');
    expect(out.notes.join(' ')).toContain('not listed in registry/papers.yml');
  });

  it('a listed paper is blocked by the same failure', async () => {
    const { out } = await validateIn('- id: a-2026-one\n  location: ./papers/a-2026-one\n');
    expect(out.checks.find((c) => c.id === 'abstract-exists')?.optional).toBeUndefined();
    expect(out.checkRun.conclusion).toBe('failure');
  });

  it('the identity checks block an unlisted paper', async () => {
    const root = colocatedRepo(['a-2026-one']);
    const out = await runValidate(
      {
        paperRoot: join(root, 'papers', 'a-2026-one'),
        instanceRoot: root,
        edge: {
          ...edge([]),
          async loadProject() {
            return { id: 'CHANGE-ME-template-placeholder' } as never;
          },
        },
      },
      { repo: 'acme/journal' },
      { existsProbe: (p) => !p.includes('_build'), listTree: () => [] },
    );
    expect(out.checkRun.conclusion).toBe('failure');
    expect(out.errors.map((e) => e.check)).toEqual(
      expect.arrayContaining(['id-shape', 'id-folder']),
    );
  });
});

describe('several papers post one Journal checks result', () => {
  const report = (conclusion: 'success' | 'failure', title: string): ChecksReport => ({
    checkRun: { conclusion, title, summary: `table ${title}`, annotations: [] },
  });

  it('one report is posted as it is', () => {
    const r = report('success', '3 passed, 0 failed');
    expect(combineReports([{ paper: 'papers/a', report: r }])).toBe(r);
  });

  it('fails when one paper fails, and names each paper', () => {
    const out = combineReports([
      { paper: 'papers/a', report: report('success', 'ok-a') },
      { paper: 'papers/b', report: report('failure', 'bad-b') },
    ]);
    expect(out.checkRun.conclusion).toBe('failure');
    expect(out.checkRun.title).toBe('a: ok-a; b: bad-b');
    expect(out.checkRun.summary).toContain('table bad-b');
  });

  it('no paper is a pass', () => {
    expect(combineReports([]).checkRun.conclusion).toBe('success');
  });

  it('a refusal fails whatever the report said', () => {
    const out = refusedReport(report('success', 'ok'), 'changes two papers');
    expect(out.checkRun.conclusion).toBe('failure');
    expect(out.checkRun.summary).toContain('changes two papers');
  });

  it('the comment names the papers the pull request changes', () => {
    expect(checksComment(report('success', 'ok'), [], ['a-2026-one'])).toContain(
      'Paper this pull request changes: `a-2026-one`',
    );
    expect(checksComment(report('success', 'ok'), [], [])).toContain('changes no paper');
    expect(checksComment(report('success', 'ok'), [])).not.toContain('changes');
  });
});

describe.skipIf(bundleState() === 'absent')(
  'post-checks holds a fork pull request to one paper',
  () => {
    beforeAll(assertBundleNotStale);
    const head = 'a'.repeat(40);

    /**
     * A co-located base checkout, Stage 1's reports downloaded into `journal-checks/<artifact>/`,
     * and a `gh` on PATH that answers the compare and pull request lookups and records what is
     * posted.
     */
    function stage2(opts: { changed: string[]; reports: string[]; headRepo: string }) {
      const root = colocatedRepo(['a-2026-one', 'b-2026-two']);
      for (const paper of opts.reports) {
        const dir = join(root, 'journal-checks', `journal-checks-${paper}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'report.json'),
          JSON.stringify({
            checkRun: {
              conclusion: 'success',
              title: '5 passed, 0 failed',
              summary: 's',
              annotations: [],
            },
          }),
        );
        writeFileSync(join(dir, 'pr-number'), '7\n');
        writeFileSync(join(dir, 'paper'), `papers/${paper}\n`);
      }
      const bin = mkdtempSync(join(tmpdir(), 'oak-gh-'));
      const posted = join(bin, 'posted');
      writeFileSync(
        join(bin, 'gh'),
        [
          '#!/usr/bin/env bash',
          'case "$*" in',
          `  *compare*) printf '%s\\n' ${opts.changed.map((f) => `'${f}'`).join(' ')} ;;`,
          `  *pulls/7*) echo ${head} ;;`,
          `  *check-runs*) cat >> "${posted}" ;;`,
          '  *) cat > /dev/null ;;',
          'esac',
        ].join('\n'),
      );
      chmodSync(join(bin, 'gh'), 0o755);
      const event = join(bin, 'event.json');
      writeFileSync(
        event,
        JSON.stringify({
          workflow_run: { head_sha: head, head_repository: { full_name: opts.headRepo } },
        }),
      );
      spawnSync('git', ['init', '-q', root]);
      spawnSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/acme/journal']);
      const r = spawnSync(
        'node',
        [
          bundlePath,
          'post-checks',
          '--report',
          'journal-checks',
          '--repo',
          'acme/journal',
          '--sha',
          head,
          '--base',
          'main',
          '--verified-head',
          head,
          '--json',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            CI: '',
            GITHUB_ACTIONS: '',
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_EVENT_NAME: 'workflow_run',
            GITHUB_EVENT_PATH: event,
            GH_TOKEN: 'x',
          },
        },
      );
      const run = existsSync(posted) ? JSON.parse(readFileSync(posted, 'utf8')) : null;
      return { code: r.status, stderr: r.stderr, run };
    }

    it('posts the paper a fork changes', () => {
      const r = stage2({
        changed: ['papers/a-2026-one/index.md'],
        reports: ['a-2026-one'],
        headRepo: 'someone/journal',
      });
      expect(r.code).toBe(0);
      expect(r.run.conclusion).toBe('success');
    });

    it('fails a fork pull request that changes two papers', () => {
      const r = stage2({
        changed: ['papers/a-2026-one/index.md', 'papers/b-2026-two/index.md'],
        reports: ['a-2026-one', 'b-2026-two'],
        headRepo: 'someone/journal',
      });
      expect(r.code).toBe(0);
      expect(r.run.conclusion).toBe('failure');
      expect(r.run.output.summary).toContain('Open one pull request per paper');
    });

    it("fails a fork whose report is another paper's", () => {
      const r = stage2({
        changed: ['papers/a-2026-one/index.md'],
        reports: ['b-2026-two'],
        headRepo: 'someone/journal',
      });
      expect(r.run.conclusion).toBe('failure');
      expect(r.run.output.summary).toContain('was not made for this change');
    });

    it('lets a branch of the repository change several papers', () => {
      const r = stage2({
        changed: ['papers/a-2026-one/index.md', 'papers/b-2026-two/index.md', 'journal.yml'],
        reports: ['a-2026-one', 'b-2026-two'],
        headRepo: 'acme/journal',
      });
      expect(r.run.conclusion).toBe('success');
      expect(r.run.output.title).toContain('a-2026-one: ');
    });

    it('passes a branch that changes no paper', () => {
      const r = stage2({ changed: ['pages/index.md'], reports: [], headRepo: 'acme/journal' });
      expect(r.code).toBe(0);
      expect(r.run.conclusion).toBe('success');
    });
  },
);

describe.skipIf(bundleState() === 'absent')(
  'a co-located paper finds the journal at the repository root',
  () => {
    beforeAll(assertBundleNotStale);

    it('oak release refuses a tag naming no paper folder, before any token', () => {
      const root = colocatedRepo(['a-2026-one']);
      spawnSync('git', ['init', '-q', root]);
      const r = spawnSync(
        'node',
        [bundlePath, 'release', '--tag', 'gone-2026-x/v1.0.0', '--no-build'],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, OAK_USE_RUNNING: '1' },
        },
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('names papers/gone-2026-x, which holds no paper');
    });

    it('oak release takes the paper from the tag and reads the journal at the root', () => {
      const root = colocatedRepo(['a-2026-one']);
      spawnSync('git', ['init', '-q', root]);
      const r = spawnSync(
        'node',
        [bundlePath, 'release', '--tag', 'a-2026-one/v1.0.0', '--no-build'],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, OAK_USE_RUNNING: '1' },
        },
      );
      // Past the journal lookup, it stops at the paper's missing DOI.
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('project.doi missing');
    });

    it('oak release refuses a tag naming another paper than --paper', () => {
      const root = colocatedRepo(['a-2026-one', 'b-2026-two']);
      spawnSync('git', ['init', '-q', root]);
      const r = spawnSync(
        'node',
        [
          bundlePath,
          'release',
          '--tag',
          'a-2026-one/v1.0.0',
          '--no-build',
          '--paper',
          'papers/b-2026-two',
        ],
        { cwd: root, encoding: 'utf8', env: { ...process.env, OAK_USE_RUNNING: '1' } },
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('names another paper than --paper');
    });
  },
);

describe('oak papers: the papers a workflow run works on', () => {
  const listed = '- id: a-1\n  location: ./papers/a-1\n- id: c-3\n  location: ./papers/c-3/\n';
  const dirs = (o: { result: Record<string, unknown> }) =>
    (o.result.papers as Array<{ dir: string }>).map((p) => p.dir);
  const none = () => {
    throw new Error('only a pull request reads the changed files');
  };

  it('a paper repository has its one paper, whatever the mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-paper-'));
    const out = selectPapers(root, { for: 'build', event: 'push' }, none);
    expect(out.result).toMatchObject({
      colocated: false,
      count: 1,
      papers: [{ dir: '.', key: '' }],
    });
    expect(selectPapers(root, { tag: 'v1.0.0' }, none).result.paper_dir).toBe('.');
    expect(selectPapers(root, { id: '' }, none).result.paper_dir).toBe('.');
    expect(selectPapers(root, { tag: 'a-1/v1.0.0' }, none).exitCode).toBe(2);
    expect(selectPapers(root, { id: 'a-1' }, none).exitCode).toBe(2);
  });

  it('builds the listed papers on a push, and no draft', () => {
    const root = colocatedRepo(['a-1', 'b-2', 'c-3'], listed);
    const out = selectPapers(root, { for: 'build', event: 'push' }, none);
    expect(out.result.papers).toEqual([
      { dir: 'papers/a-1', key: 'a-1' },
      { dir: 'papers/c-3', key: 'c-3' },
    ]);
    expect(out.result.colocated).toBe(true);
  });

  it('checks every paper on a push', () => {
    const root = colocatedRepo(['a-1', 'b-2'], listed);
    expect(dirs(selectPapers(root, { for: 'check', event: 'push' }, none))).toEqual([
      'papers/a-1',
      'papers/b-2',
    ]);
  });

  it('on a pull request, builds and checks the papers it changes', () => {
    const root = colocatedRepo(['a-1', 'b-2', 'c-3']);
    const changed = () => ['papers/a-1/index.md', 'papers/c-3/fig.png'];
    for (const f of ['build', 'check'] as const)
      expect(dirs(selectPapers(root, { for: f, event: 'pull_request' }, changed))).toEqual([
        'papers/a-1',
        'papers/c-3',
      ]);
  });

  it('a pull request changing anything outside papers/ checks every paper, and builds the changed ones', () => {
    const root = colocatedRepo(['a-1', 'b-2']);
    const changed = () => ['registry/papers.yml', 'papers/b-2/index.md'];
    expect(dirs(selectPapers(root, { for: 'check', event: 'pull_request' }, changed))).toEqual([
      'papers/a-1',
      'papers/b-2',
    ]);
    expect(dirs(selectPapers(root, { for: 'build', event: 'pull_request' }, changed))).toEqual([
      'papers/b-2',
    ]);
  });

  it('a pull request changing no paper selects none', () => {
    const root = colocatedRepo(['a-1']);
    const out = selectPapers(root, { for: 'build', event: 'pull_request' }, () => [
      'pages/index.md',
    ]);
    expect(out.result).toMatchObject({ papers: [], count: 0 });
  });

  it('a tag or an id names one existing paper', () => {
    const root = colocatedRepo(['a-1']);
    expect(selectPapers(root, { tag: 'a-1/v1.0.0' }, none).result.paper_dir).toBe('papers/a-1');
    expect(selectPapers(root, { id: 'a-1' }, none).result.paper_dir).toBe('papers/a-1');
    for (const tag of ['v1.0.0', 'gone/v1.0.0', '../x/v1.0.0', 'a-1/v1.0'])
      expect(selectPapers(root, { tag }, none).exitCode, tag).toBe(2);
    for (const id of ['', 'gone', '../a-1', 'a-1 x', 'a-1/..'])
      expect(selectPapers(root, { id }, none).exitCode, id).toBe(2);
  });
});

describe.skipIf(bundleState() === 'absent')('oak papers through the bundle', () => {
  beforeAll(assertBundleNotStale);
  const papers = (cwd: string, args: string[], env: Record<string, string> = {}) => {
    const resultFile = join(mkdtempSync(join(tmpdir(), 'oak-result-')), 'result.json');
    const r = spawnSync('node', [bundlePath, 'papers', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, OAK_USE_RUNNING: '1', OAK_RESULT_FILE: resultFile, ...env },
    });
    const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null;
    return { code: r.status, result };
  };

  it('--id-env reads the reserve-doi input from PAPER_ID as one value', () => {
    const root = colocatedRepo(['a-1']);
    expect(papers(root, ['--id-env'], { PAPER_ID: 'a-1' }).result.paper_dir).toBe('papers/a-1');
    // A space would split a spliced argument into two; through the environment it is one id,
    // and not a paper.
    expect(papers(root, ['--id-env'], { PAPER_ID: 'a-1 --tag v1.0.0' }).code).toBe(2);
  });

  it('records the selection as the result the workflows read', () => {
    const root = colocatedRepo(['a-1'], '- id: a-1\n  location: ./papers/a-1\n');
    const r = papers(root, ['--for', 'build'], { GITHUB_EVENT_NAME: 'push' });
    expect(r.code).toBe(0);
    expect(r.result).toMatchObject({
      colocated: true,
      count: 1,
      papers: [{ dir: 'papers/a-1', key: 'a-1' }],
    });
  });
});
