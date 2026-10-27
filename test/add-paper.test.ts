/**
 * `oak add-paper`, with a fake gh: the id checks before anything is forked, the edition from the
 * year in the id, the seeded folder, and the pull request.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { cmdAddPaper, defaultEdition, type AddPaperGh } from '../src/add-paper.js';
import { renderColocatedTemplate } from '../src/bootstrap.js';

const roots = { paper: 'templates/paper', instance: 'templates/instance', site: 'templates/site' };

/** A co-located journal's main, as bootstrap seeds it, with edition 2026 and `papers`. */
function journal(papers: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'oak-add-'));
  renderColocatedTemplate(
    roots,
    dir,
    {
      engineRepo: 'me/engine',
      instanceRepo: '.',
      owner: '@ed',
      version: 'v1.2.3',
      edition: '2026',
      journalName: 'J',
      repo: 'acme/journal',
      repoEngineVersion: 'v1.2.3',
    },
    '^1.0.0',
  );
  for (const id of papers) mkdirSync(join(dir, 'papers', id), { recursive: true });
  return dir;
}

function fakeGh(dir: string) {
  const calls: string[] = [];
  const gh: AddPaperGh = {
    authedUser: () => 'ada',
    checkout: (repo, branch) => {
      calls.push(`checkout ${repo} ${branch}`);
      return dir;
    },
    fork: (repo) => {
      calls.push(`fork ${repo}`);
      return `ada/${repo.split('/')[1]}`;
    },
    commitAndPush: (_d, fork, branch, paths) => calls.push(`push ${fork} ${branch} ${paths}`),
    openPr: (repo, o) => {
      calls.push(`pr ${repo} ${o.head} ${o.title}`);
      return 'https://github.com/acme/journal/pull/3';
    },
  };
  return { gh, calls };
}

const run = (dir: string, id: string, edition?: string) => {
  const { gh, calls } = fakeGh(dir);
  return cmdAddPaper(
    { repo: 'acme/journal', id, ...(edition ? { edition } : {}), paperTemplateRoot: roots.paper },
    { gh, log: () => {}, confirm: async () => true },
  ).then((out) => ({ out, calls }));
};

describe('defaultEdition', () => {
  it('is the year in the id', () => {
    expect(defaultEdition('smith-2026-title')).toBe('2026');
    expect(defaultEdition('2027-x')).toBe('2027');
    expect(defaultEdition('smith-title')).toBeUndefined();
    expect(defaultEdition('a-20261-b')).toBeUndefined();
  });
});

describe('cmdAddPaper', () => {
  it('seeds papers/<id>/ on a fork branch and opens the pull request', async () => {
    const dir = journal();
    const { out, calls } = await run(dir, 'smith-2026-tides');
    expect(out.exitCode).toBe(0);
    expect(calls).toEqual([
      'checkout acme/journal add-smith-2026-tides',
      'fork acme/journal',
      'push ada/journal add-smith-2026-tides papers/smith-2026-tides',
      'pr acme/journal ada:add-smith-2026-tides Submission of interest: smith-2026-tides',
    ]);
    const paper = join(dir, 'papers', 'smith-2026-tides');
    const myst = parseDocument(readFileSync(join(paper, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'id'])).toBe('smith-2026-tides');
    expect(myst.getIn(['project', 'github'])).toBe('https://github.com/acme/journal');
    expect(myst.getIn(['project', 'options', 'oaktree-sapling', 'version'])).toBe('v1.2.3');
    expect(myst.getIn(['project', 'options', 'oaktree-sapling', 'edition'])).toBe('2026');
    for (const f of ['index.md', 'bib.bib', '.gitignore', 'thumbnails/thumbnail.png'])
      expect(existsSync(join(paper, f)), f).toBe(true);
    // The launchers stay at the repository root.
    expect(existsSync(join(paper, '.github'))).toBe(false);
    expect(existsSync(join(paper, 'CODEOWNERS'))).toBe(false);
  });

  it("refuses an id the journal's id_pattern rejects, before forking", async () => {
    const { out, calls } = await run(journal(), 'Smith_2026_x', '2026');
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('id pattern');
    expect(calls.some((c) => c.startsWith('fork'))).toBe(false);
  });

  it('refuses an id that is not a folder name, before any call', async () => {
    for (const id of ['../x', 'a/b', '.x', 'a b']) {
      const { out, calls } = await run(journal(), id);
      expect(out.exitCode, id).toBe(2);
      expect(calls, id).toEqual([]);
    }
  });

  it('refuses an id a merged submission already claims', async () => {
    const { out } = await run(journal(['smith-2026-tides']), 'smith-2026-tides');
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('already has papers/smith-2026-tides');
  });

  it('refuses an edition the journal does not have', async () => {
    const { out } = await run(journal(), 'smith-2027-tides');
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('editions/2027.yml');
    expect((await run(journal(), 'smith-2027-tides', '2026')).out.exitCode).toBe(0);
  });

  it('refuses a journal that is not co-located', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-add-'));
    writeFileSync(join(dir, 'journal.yml'), 'name: J\n');
    const { out } = await run(dir, 'smith-2026-tides');
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('not a co-located journal');
  });
});
