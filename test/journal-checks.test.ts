/**
 * A journal's own check files [R208], run by `runChecks` without the bundle: the `paper` is built
 * by hand, and only check files are listed, so the Curvenote catalog (and myst-cli) is never
 * imported. Each file under `test/journal-checks/` does one thing a real check file might get
 * wrong. The two worked examples run through the bundle in `test/validate.integration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { toText } from 'myst-common';
import { selectAll } from 'unist-util-select';
import { runChecks, toCheckRun, type JournalCheck } from '../src/checks.js';
import type { Paper } from '../src/journal-checks.js';
import * as messages from '../src/messages.js';
import { DOCS, docsUrl } from '../src/docs-links.js';

const journalRoot = fileURLToPath(new URL('./journal-checks', import.meta.url));
const session = {} as never;

function handBuiltPaper(): Paper {
  return {
    root: '/paper',
    project: { title: 'A Paper' },
    pages: [
      {
        file: '/paper/index.md',
        frontmatter: {},
        mdast: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', value: 'One' }] },
            { type: 'paragraph', children: [{ type: 'text', value: 'Two' }] },
          ],
        },
      },
    ],
    toText,
    selectAll,
  };
}

function run(checks: JournalCheck[], paper: Paper = handBuiltPaper(), importer?: never) {
  return runChecks(session, checks, journalRoot, () => paper, importer);
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
    expect(messages.pr.unknownCheckId('checks/x.mjs')).toContain(docsUrl(DOCS.checksJournal));
  });
});

describe('loading and options', () => {
  it('a file listed twice is imported once and gets each entry its own options', async () => {
    const urls: string[] = [];
    const importer = (async (url: string) => {
      urls.push(url);
      return import(url);
    }) as never;
    const out = await run(
      [
        { id: './echo.mjs', result: { status: 'pass', message: 'first' } },
        { id: './echo.mjs', result: { status: 'fail', message: 'second' } },
      ],
      handBuiltPaper(),
      importer,
    );
    expect(urls).toHaveLength(1);
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
      { id: './reads-tree.mjs', status: 'pass', message: '2 nodes, title A Paper' },
    ]);
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
