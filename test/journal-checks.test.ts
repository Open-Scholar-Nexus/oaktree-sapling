/**
 * A journal's own check files [R208], run by `runChecks` without the bundle: the `paper` is built
 * by hand, and only check files are listed, so the Curvenote catalog (and myst-cli) is never
 * imported. Each file under `test/journal-checks/` does one thing a real check file might get
 * wrong. The worked examples run through the bundle in `test/validate.integration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toText } from 'myst-common';
import { selectAll } from 'unist-util-select';
import { runChecks, toCheckRun, type JournalCheck } from '../src/checks.js';
import { readFileFrontmatter, type Paper } from '../src/journal-checks.js';
import * as messages from '../src/messages.js';
import { DOCS, docsUrl } from '../src/docs-links.js';

const journalRoot = fileURLToPath(new URL('./journal-checks', import.meta.url));
const session = {} as never;

function handBuiltPaper(): Paper {
  return {
    root: '/paper',
    project: { title: 'A Paper' },
    projectParts: {},
    config: { project: { title: 'A Paper' } },
    repo: 'owner/paper',
    journal: { config: { name: 'A Journal' } as never, registry: [] },
    pages: [
      {
        file: '/paper/index.md',
        frontmatter: {},
        fileFrontmatter: {},
        mdast: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', value: 'One' }] },
            { type: 'paragraph', children: [{ type: 'text', value: 'Two' }] },
          ],
        },
        parts: {},
      },
    ],
    toText,
    selectAll,
  };
}

function run(checks: JournalCheck[], paper: Paper = handBuiltPaper()) {
  return runChecks(session, checks, { journalRoot, readPaper: () => paper });
}

const pass = { status: 'pass', message: 'fine' };

describe('a check file that fails gives one error row, and the next check still runs', () => {
  const broken: Array<[string, JournalCheck, RegExp]> = [
    ['throws', { id: './throws.mjs' }, /stopped with an error: thrown on purpose/],
    ['rejects', { id: './rejects.mjs' }, /stopped with an error: rejected on purpose/],
    ['has no default export', { id: './no-default.mjs' }, /no default export with a validate/],
    ['has a syntax error', { id: './syntax-error.mjs' }, /did not load/],
    [
      'returns an unknown status',
      { id: './echo.mjs', result: { status: 'maybe', message: 'x' } },
      /cannot read \(at status\)/,
    ],
    [
      'returns a position without start.line',
      { id: './echo.mjs', result: { status: 'fail', message: 'x', position: { start: {} } } },
      /cannot read \(at position\.start\.line\)/,
    ],
    ['returns nothing', { id: './echo.mjs' }, /cannot read/],
    [
      'returns a bad second result',
      { id: './echo.mjs', result: [pass, { status: 'fail' }] },
      /cannot read \(at 1\.message\)/,
    ],
  ];
  for (const [what, entry, message] of broken) {
    it(`when it ${what}`, async () => {
      const out = await run([entry, { id: './echo.mjs', result: pass }]);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ id: entry.id, status: 'error' });
      expect(out[0]!.message).toMatch(message);
      expect(out[0]!.message).toContain(docsUrl(DOCS.checksJournal));
      expect(out[1]).toMatchObject({ id: './echo.mjs', status: 'pass', message: 'fine' });
    });
  }
});

describe('a check file path is refused', () => {
  const refused: Array<[string, string]> = [
    ['../x.mjs', messages.pr.checkFileOutside],
    ['./sub/../../x.mjs', messages.pr.checkFileOutside],
    ['./not-mjs.js', messages.pr.checkFileNotMjs],
    ['./missing.mjs', messages.pr.checkFileMissing(`${journalRoot}/missing.mjs`)],
  ];
  for (const [id, message] of refused) {
    it(id, async () => {
      const out = await run([{ id }]);
      expect(out).toEqual([{ id, status: 'error', message }]);
    });
  }

  it('an id ending in .mjs without ./ gets a hint', () => {
    expect(messages.pr.unknownCheckId('checks/x.mjs')).toContain('"./checks/x.mjs"');
    expect(messages.pr.unknownCheckId('/checks/x.mjs')).toContain('"./checks/x.mjs"');
    expect(messages.pr.unknownCheckId('checks/x.mjs')).toContain(docsUrl(DOCS.checksJournal));
  });
});

describe('loading and options', () => {
  it('a file listed twice gets each entry its own options', async () => {
    const out = await run([
      { id: './echo.mjs', result: { status: 'pass', message: 'first' } },
      { id: './echo.mjs', result: { status: 'fail', message: 'second' } },
    ]);
    expect(out.map((r) => r.message)).toEqual(['first', 'second']);
  });

  it('options leave out optional, and keep the id', async () => {
    const out = await run([{ id: './echo.mjs', optional: true, result: pass }]);
    expect(out).toEqual([{ id: './echo.mjs', status: 'pass', message: 'fine', optional: true }]);
  });

  it('an empty list adds no row', async () => {
    expect(await run([{ id: './echo.mjs', result: [] }])).toEqual([]);
  });
});

describe('a paper oak cannot read', () => {
  it('every check file sends the author to the editors', async () => {
    const out = await runChecks(session, [{ id: './echo.mjs' }, { id: './throws.mjs' }], {
      journalRoot,
      readPaper: () => {
        throw new Error('no project');
      },
    });
    const message = messages.pr.checkFilePaperUnreadable('no project');
    expect(out).toEqual([
      { id: './echo.mjs', status: 'error', message },
      { id: './throws.mjs', status: 'error', message },
    ]);
  });

  it('is not read for a check file that does not load', async () => {
    const out = await runChecks(session, [{ id: './missing.mjs' }], {
      journalRoot,
      readPaper: () => {
        throw new Error('unreachable');
      },
    });
    expect(out[0]!.message).toBe(messages.pr.checkFileMissing(`${journalRoot}/missing.mjs`));
  });
});

describe('a check file that does not finish in time', () => {
  it('is an error row, keeps its optional, and the next check still runs', async () => {
    const out = await runChecks(
      session,
      [
        { id: './hangs.mjs' },
        { id: './hangs.mjs', optional: true },
        { id: './echo.mjs', result: pass },
      ],
      { journalRoot, readPaper: handBuiltPaper, timeoutMs: 50 },
    );
    // 50 ms rounds down to 0 seconds.
    const message = messages.pr.checkTimedOut(0);
    expect(out).toEqual([
      { id: './hangs.mjs', status: 'error', message },
      { id: './hangs.mjs', status: 'error', message, optional: true },
      { id: './echo.mjs', status: 'pass', message: 'fine' },
    ]);
  });
});

describe('optional', () => {
  it("the journal's optional: true and a result's own optional both make a warning", async () => {
    const fail = { status: 'fail', message: 'bad' };
    const out = await run([
      { id: './echo.mjs', optional: true, result: fail },
      { id: './echo.mjs', result: { ...fail, optional: true } },
      { id: './throws.mjs', optional: true },
    ]);
    expect(out.map((r) => r.optional)).toEqual([true, true, true]);
    const checkRun = toCheckRun(out);
    expect(checkRun.conclusion).toBe('success');
    expect(checkRun.title).toBe('0 passed, 0 failed, 3 warnings');
    expect(checkRun.summary).toContain('| ./echo.mjs | fail (optional) | bad |');
  });

  it('a result without optional still blocks', async () => {
    const out = await run([{ id: './echo.mjs', result: { status: 'fail', message: 'bad' } }]);
    expect(toCheckRun(out).conclusion).toBe('failure');
  });
});

describe('each check reads its own copy of the paper', () => {
  it('a tree one check edits is unchanged for the next', async () => {
    const paper = handBuiltPaper();
    const out = await run([{ id: './edits-tree.mjs' }, { id: './reads-tree.mjs' }], paper);
    expect(out).toEqual([
      { id: './reads-tree.mjs', status: 'pass', message: '2 nodes, title A Paper, A Journal' },
    ]);
    expect(paper.journal.config.name).toBe('A Journal');
    expect(paper.pages[0]!.mdast.children).toHaveLength(2);
  });

  it('result positions become inline annotations', async () => {
    const position = { start: { line: 3, column: 1 }, end: { line: 3, column: 9 } };
    const out = await run([
      {
        id: './echo.mjs',
        result: { status: 'fail', message: 'bad', file: '/paper/index.md', position },
      },
    ]);
    expect(toCheckRun(out, '/paper').annotations).toEqual([
      {
        path: 'index.md',
        start_line: 3,
        end_line: 3,
        annotation_level: 'failure',
        message: 'bad',
      },
    ]);
  });
});

describe("a page's frontmatter as written", () => {
  const dir = mkdtempSync(join(tmpdir(), 'oak-file-frontmatter-'));
  const read = (name: string, text: string) => {
    writeFileSync(join(dir, name), text);
    return readFileFrontmatter(join(dir, name));
  };

  it('is the block at the top of the file, without the fields MyST fills in', () => {
    expect(read('a.md', '---\ntitle: T\nauthors: [A]\n---\n# Body\n')).toEqual({
      title: 'T',
      authors: ['A'],
    });
  });

  it('is empty for a page without one, or with an empty one', () => {
    expect(read('b.md', '# Body\n\n---\ntitle: T\n---\n')).toEqual({});
    expect(read('c.md', '---\n---\n# Body\n')).toEqual({});
  });

  it('is null when the block is not a YAML mapping, or the page is not markdown', () => {
    expect(read('d.md', '---\ntitle: [unclosed\n---\n')).toBeNull();
    expect(read('e.md', '---\n- a list\n---\n')).toBeNull();
    expect(read('f.ipynb', '{"cells": []}')).toBeNull();
  });
});

describe('positionOf', () => {
  const at = (line: number) => ({ start: { line, column: 1 }, end: { line, column: 1 } });
  /** A figure and an `{image}` as MyST makes them from directives: with no `position`. */
  function paperWithDirectives(): Paper {
    const paper = handBuiltPaper();
    paper.pages[0]!.mdast = {
      type: 'root',
      position: { start: { line: 1, column: 1 }, end: { line: 12, column: 1 } },
      children: [
        { type: 'paragraph', position: at(3), children: [{ type: 'text', value: 'Text' }] },
        {
          type: 'container',
          kind: 'figure',
          children: [
            { type: 'image', url: 'in-figure.png' },
            { type: 'caption', children: [{ type: 'paragraph', position: at(7), children: [] }] },
          ],
        },
        { type: 'image', url: 'directive.png' },
        { type: 'image', url: 'markdown.png', position: at(11) },
      ],
    };
    return paper;
  }

  it("is a node's own position, else the line of the nearest node before it that has one", async () => {
    const out = await run([{ id: './image-positions.mjs' }], paperWithDirectives());
    expect(out.map((r) => [r.message, r.position?.start.line])).toEqual([
      ['in-figure.png', 3],
      ['directive.png', 7],
      ['markdown.png', 11],
      ['made', undefined],
    ]);
  });
});

describe('the edition-aware example in the docs', () => {
  const entry = { id: './orcid-by-edition.mjs', warn_in: ['2025'] };
  function paperIn(edition: string): Paper {
    const paper = handBuiltPaper();
    paper.project = {
      options: { 'oaktree-sapling': { version: 'v0.4.0', edition } },
      authors: [{ name: 'Ada', orcid: '0000-0002-1825-0097' }, { name: 'Bo' }],
    };
    return paper;
  }

  it('warns for a paper in an edition warn_in names, and blocks for one in another', async () => {
    expect(await run([entry], paperIn('2025'))).toMatchObject([
      { status: 'fail', message: 'Bo does not have an ORCID', optional: true },
    ]);
    const out = await run([entry], paperIn('2026'));
    expect(out).toMatchObject([{ status: 'fail', message: 'Bo does not have an ORCID' }]);
    expect(toCheckRun(out).conclusion).toBe('failure');
  });
});
