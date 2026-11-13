/**
 * The docs plugin that turns `src:path@name` and `src:path@"text"` links into GitHub line ranges.
 * A wrong range is a link that quietly shows the wrong code, so each form is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: a plain .mjs docs plugin, without types.
import { findSymbol, findText, resolve } from '../docs/plugins/source-links.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const lines = (path: string, [a, b]: [number, number]): string[] =>
  readFileSync(root + path, 'utf8')
    .split('\n')
    .slice(a, b + 1);

const TS = `import { x } from 'y';

/**
 * Doc.
 */
export function f(a: string): { b: string } {
  const s = \`}\${a}{\`;
  return { b: s };
}

// not JSDoc
const g = (n: number) =>
  n + 1;

export const msg = {
  one: 'a, b',
  two: (n: number): string =>
    \`\${n} {\` +
    'x',
  three() {
    return 1;
  },
  last: 1
};

type T = { a: string } & {
  b: number;
};
interface I {
  a: string;
}
const dup = 1;
function h() {
  const dup = 2;
}
export function re(v: string) {
  return /^\.\.?\//.test(v) && v !== '}';
}
export const chain = z
  .string()
  .min(1);
interface Opts {
  re: string;
}
run(
  chain,
);
`;

describe('findSymbol', () => {
  it('spans a function from its JSDoc to its closing brace', () => {
    expect(findSymbol(TS, 'f')).toEqual([2, 8]);
  });

  it('spans a const to the end of the statement, without a // comment', () => {
    expect(findSymbol(TS, 'g')).toEqual([11, 12]);
  });

  it('spans an object key to its comma, past braces and commas in strings', () => {
    expect(findSymbol(TS, 'one')).toEqual([15, 15]);
    expect(findSymbol(TS, 'two')).toEqual([16, 18]);
  });

  it('spans a method and a last key with no trailing comma', () => {
    expect(findSymbol(TS, 'three')).toEqual([19, 21]);
    expect(findSymbol(TS, 'last')).toEqual([22, 22]);
  });

  it('spans a type and an interface', () => {
    expect(findSymbol(TS, 'T')).toEqual([25, 27]);
    expect(findSymbol(TS, 'I')).toEqual([28, 30]);
  });

  it('skips a regex literal, and follows a chain onto the next line', () => {
    expect(findSymbol(TS, 're')).toEqual([35, 37]);
    expect(findSymbol(TS, 'chain')).toEqual([38, 40]);
  });

  it('reads a call at the start of a line as a call, not a method', () => {
    expect(findSymbol(TS, 'run')).toBe("no declaration of 'run'");
  });

  it('refuses a name it cannot find, or finds twice', () => {
    expect(findSymbol(TS, 'nope')).toBe("no declaration of 'nope'");
    expect(findSymbol(TS, 'dup')).toBe("'dup' is declared on lines 32, 34");
  });

  it('finds a message in src/messages.ts', () => {
    const range = findSymbol(readFileSync(root + 'src/messages.ts', 'utf8'), 'runbookForkApproval');
    const found = lines('src/messages.ts', range);
    expect(found[0]).toMatch(/^\s*runbookForkApproval:$/);
    expect(found.at(-1)).toMatch(/`,$/);
  });
});

describe('findText', () => {
  it('spans a whole test from its it( line', () => {
    const path = 'test/artifact.test.ts';
    const text = 'refuses a real pull request whose head is another commit';
    const found = lines(path, findText(readFileSync(root + path, 'utf8'), text, path));
    expect(found[0]).toContain(text);
    expect(found.at(-1)).toBe('  });');
  });

  it('spans a YAML step, with the comment above it', () => {
    const path = 'templates/paper/.github/actions/engine/action.yml';
    const found = lines(path, findText(readFileSync(root + path, 'utf8'), 'id: ref', path));
    expect(found[0]).toMatch(/^\s*#/);
    expect(found[1]).toBe('    - id: ref');
    expect(found.at(-1)).toContain('>> "$GITHUB_OUTPUT"');
  });

  it('spans the YAML item that holds a key below its dash', () => {
    const yml = 'steps:\n  - uses: a\n    with:\n      x: 1\n  - uses: b\n';
    expect(findText(yml, 'with:', 'a.yml')).toEqual([1, 3]);
  });

  it('links one line when no block holds it', () => {
    expect(findText('a: 1\nb: 2\n', 'b:', 'a.yml')).toEqual([1, 1]);
    expect(findText(TS, 'return 1', 'a.ts')).toEqual([20, 20]);
    expect(findText(TS, 'nowhere', 'a.ts')).toBe('no line contains "nowhere"');
  });
});

describe('resolve', () => {
  const read = (): string => TS;
  const base = 'https://github.com/Open-Scholar-Nexus/oaktree-sapling/blob/';

  it('keeps a path or a #L range as written', () => {
    expect(resolve('src:src/a.ts#L1-L2', read).url).toMatch(/\/blob\/[^/]+\/src\/a\.ts#L1-L2$/);
  });

  it('links a name, and quoted text in a percent-encoded URL', () => {
    expect(resolve('src:a.ts@f', read).url).toMatch(/^https:.*\/a\.ts#L3-L9$/);
    expect(resolve('src:a.ts@%22return%201%22', read).url).toMatch(/\/a\.ts#L21$/);
    expect(resolve('src:a.ts@f', read).url.startsWith(base)).toBe(true);
  });

  it('names the link in every refusal', () => {
    expect(resolve('src:a.ts@nope', read).error).toBe("a.ts@nope: no declaration of 'nope'");
    expect(resolve('src:a.md@f', read).error).toMatch(/^a\.md@f: a name works only in a code file/);
    expect(resolve('src:/abs', read).error).toBe('/abs needs a repository-relative path');
    const missing = (): string => {
      throw new Error();
    };
    expect(resolve('src:x.ts@f', missing).error).toBe('x.ts@f: no file at x.ts');
  });
});
