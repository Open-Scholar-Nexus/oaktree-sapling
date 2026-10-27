/**
 * `oak release` on an editor's computer, with a fake `CiBuildSource` (no git or gh): the clone
 * must be at the tag, the build comes from the tag's own Deposit version run once its build job
 * passed, and the download replaces the build outputs in the paper. Also the plugins the
 * `--local-build` warning lists.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addedPlugins,
  assertAtTag,
  depositRunFor,
  fetchCiBuild,
  parseTypstVersion,
  DEPOSIT_WORKFLOW_PATH,
  RELEASE_ARTIFACT,
  type CiBuildSource,
  type CiJob,
  type CiRun,
} from '../src/release.js';
import { galleryPluginUrl } from '../src/bootstrap.js';
import { UserError } from '../src/messages.js';

const TAG = 'v1.2.0';
const SHA = 'a'.repeat(40);
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

const run = (over: Partial<CiRun> = {}): CiRun => ({
  id: 7,
  path: DEPOSIT_WORKFLOW_PATH,
  event: 'push',
  headBranch: TAG,
  headSha: SHA,
  url: 'https://github.com/o/paper/actions/runs/7',
  ...over,
});

const BUILT_AT = '2026-10-20T09:00:00Z';
const job = (over: Partial<CiJob> = {}): CiJob => ({
  name: 'build',
  status: 'completed',
  conclusion: 'success',
  completedAt: BUILT_AT,
  ...over,
});

/** A clone at the tag whose Deposit version run built it; `over` changes one answer. */
function fakeSource(
  over: Partial<CiBuildSource> & { jobList?: CiJob[]; runs?: CiRun[] } = {},
): CiBuildSource & { downloads: Array<[string, number, string]> } {
  const downloads: Array<[string, number, string]> = [];
  return {
    downloads,
    originRepo: () => 'o/paper',
    tagCommit: () => SHA,
    headSha: () => SHA,
    trackedChanges: () => false,
    pushRuns: () => over.runs ?? [run()],
    jobs: () => over.jobList ?? [job()],
    download: (repo, id, name, dest) => {
      downloads.push([repo, id, name]);
      mkdirSync(join(dest, '_build', 'exports'), { recursive: true });
      writeFileSync(join(dest, '_build', 'exports', 'paper.pdf'), '%PDF from CI');
      writeFileSync(join(dest, 'myst.oak.yml'), 'from: ci\n');
      writeFileSync(join(dest, 'stray.txt'), 'not a build output');
    },
    ...over,
  };
}

function refusal(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(UserError);
    return (e as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('the clone must be at the tag', () => {
  it('returns the tag commit when HEAD is there and nothing tracked changed', () => {
    expect(assertAtTag('/paper', TAG, fakeSource())).toBe(SHA);
  });

  it('refuses a clone without the tag, at another commit, or with changes', () => {
    expect(refusal(() => assertAtTag('/p', TAG, fakeSource({ tagCommit: () => null })))).toContain(
      'git fetch --tags',
    );
    expect(
      refusal(() => assertAtTag('/p', TAG, fakeSource({ headSha: () => 'b'.repeat(40) }))),
    ).toContain(`git checkout ${TAG}`);
    expect(
      refusal(() => assertAtTag('/p', TAG, fakeSource({ trackedChanges: () => true }))),
    ).toContain('changes to tracked files');
  });
});

describe("the tag's Deposit version run", () => {
  it('is a push of that tag at that commit, the newest first', () => {
    const runs = [
      run({ id: 1, path: '.github/workflows/build-paper.yml' }),
      run({ id: 2, event: 'workflow_dispatch' }),
      run({ id: 3, headBranch: 'v1.1.0' }),
      run({ id: 4, headSha: 'c'.repeat(40) }),
      run({ id: 5 }),
      run({ id: 6 }),
    ];
    expect(depositRunFor(runs, TAG, SHA)?.id).toBe(5);
    expect(depositRunFor(runs.slice(0, 4), TAG, SHA)).toBeNull();
  });

  it('is matched by workflow file, so a run of another file with the same name is not picked', () => {
    const runs = [run({ id: 1, path: '.github/workflows/copy.yml' }), run({ id: 2 })];
    expect(depositRunFor(runs, TAG, SHA)?.id).toBe(2);
    expect(depositRunFor(runs.slice(0, 1), TAG, SHA)).toBeNull();
  });
});

describe('fetchCiBuild', () => {
  it('downloads the artifact over the build outputs, and nothing else', () => {
    const paper = tmp('oak-release-');
    mkdirSync(join(paper, '_build', 'exports'), { recursive: true });
    writeFileSync(join(paper, '_build', 'exports', 'stale.pdf'), '%PDF local');
    const src = fakeSource();
    const got = fetchCiBuild(paper, TAG, SHA, src);
    expect(got.run.id).toBe(7);
    expect(got.builtAt).toBe(BUILT_AT);
    expect(src.downloads).toEqual([['o/paper', 7, RELEASE_ARTIFACT]]);
    expect(readFileSync(join(paper, '_build', 'exports', 'paper.pdf'), 'utf8')).toBe(
      '%PDF from CI',
    );
    expect(existsSync(join(paper, '_build', 'exports', 'stale.pdf'))).toBe(false);
    expect(readFileSync(join(paper, 'myst.oak.yml'), 'utf8')).toBe('from: ci\n');
    expect(existsSync(join(paper, 'stray.txt'))).toBe(false);
  });

  it('reads only the build job, so a paper still carrying a publish job beside it works', () => {
    const src = fakeSource({
      jobList: [job(), job({ name: 'publish', conclusion: 'failure' })],
    });
    expect(fetchCiBuild(tmp('oak-release-'), TAG, SHA, src).run.id).toBe(7);
  });

  it('refuses while the build runs, after it failed, or with no run, downloading nothing', () => {
    const pending = fakeSource({
      jobList: [job({ status: 'in_progress', conclusion: null, completedAt: null })],
    });
    expect(refusal(() => fetchCiBuild('/p', TAG, SHA, pending))).toContain('still building');
    const failed = fakeSource({
      jobList: [job({ conclusion: 'failure' })],
    });
    expect(refusal(() => fetchCiBuild('/p', TAG, SHA, failed))).toContain('build failed');
    const none = fakeSource({ runs: [run({ headBranch: 'v9.9.9' })] });
    expect(refusal(() => fetchCiBuild('/p', TAG, SHA, none))).toContain('no Deposit version run');
    for (const src of [pending, failed, none]) expect(src.downloads).toEqual([]);
  });

  it('refuses a clone with no GitHub origin', () => {
    expect(
      refusal(() => fetchCiBuild('/p', TAG, SHA, fakeSource({ originRepo: () => null }))),
    ).toContain('no GitHub origin remote');
  });

  it('a failing gh call is a sentence, not a stack', () => {
    const src = fakeSource({
      pushRuns: () => {
        throw new Error('gh api failed (exit 1): HTTP 401');
      },
    });
    expect(refusal(() => fetchCiBuild('/p', TAG, SHA, src))).toContain('HTTP 401');
  });
});

describe('the plugins a --local-build warning lists', () => {
  it("leaves out the edition's plugins and oak's gallery plugin at the pinned version", () => {
    const pin = { engineRepo: 'o/engine', version: 'v0.4.0' };
    const paper = tmp('oak-plugins-paper-');
    writeFileSync(
      join(paper, 'myst.yml'),
      [
        'version: 1',
        'project:',
        '  options:',
        '    oaktree-sapling:',
        '      edition: e1',
        '  plugins:',
        `    - ${galleryPluginUrl(pin.engineRepo, pin.version)}`,
        `    - ${galleryPluginUrl(pin.engineRepo, 'v0.3.0')}`,
        '    - journal.mjs',
        '    - mine.mjs',
        '    - type: executable',
        '      path: run.py',
        '',
      ].join('\n'),
    );
    const journal = tmp('oak-plugins-journal-');
    mkdirSync(join(journal, 'editions'));
    writeFileSync(join(journal, 'editions', 'e1.yml'), 'project:\n  plugins:\n    - journal.mjs\n');
    expect(addedPlugins(paper, journal, pin)).toEqual([
      galleryPluginUrl(pin.engineRepo, 'v0.3.0'),
      'mine.mjs',
      'run.py',
    ]);
    expect(addedPlugins(paper, null, undefined)).toHaveLength(5);
  });
});

describe('parseTypstVersion', () => {
  it('reads the version from typst --version', () => {
    expect(parseTypstVersion('typst 0.13.1 (8ace67d9)\n')).toBe('0.13.1');
    expect(parseTypstVersion('typst 0.14.2')).toBe('0.14.2');
  });

  it('is null for output it does not know', () => {
    expect(parseTypstVersion('')).toBeNull();
    expect(parseTypstVersion('command not found')).toBeNull();
  });
});
