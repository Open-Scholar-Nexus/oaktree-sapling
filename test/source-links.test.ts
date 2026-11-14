/** The docs plugin that turns `src:` links into GitHub URLs, one line for a name or text. */
import { describe, it, expect } from 'vitest';
// @ts-expect-error: a plain .mjs docs plugin, without types.
import { findLine, resolve } from '../docs/plugins/source-links.mjs';

const TS = `interface I {
  f: string;
}
export function f() {}
export const msg = {
  hint: 'see "the docs"',
};
`;
const read = (): string => TS;

describe('findLine', () => {
  it('finds a declaration before a key of the same name', () => {
    expect(findLine(TS, 'f')).toBe(4);
    expect(findLine(TS, 'hint')).toBe(6);
  });

  it('finds the first line holding quoted text', () => {
    expect(findLine(TS, '"the docs"')).toBe(6);
  });

  it('reports a miss', () => {
    expect(findLine(TS, 'nope')).toBe("no declaration of 'nope'");
    expect(findLine(TS, '"nowhere"')).toBe('no line contains "nowhere"');
  });
});

describe('resolve', () => {
  it('keeps a path or a line range as written', () => {
    expect(resolve('src:src/a.ts', read).url).toMatch(/\/blob\/[^/]+\/src\/a\.ts$/);
    expect(resolve('src:src/a.ts#L1-L2', read).url).toMatch(/\/src\/a\.ts#L1-L2$/);
  });

  it('links one line for a name or percent-encoded text, and names the link on a miss', () => {
    expect(resolve('src:a.ts@msg', read).url).toMatch(/\/a\.ts#L5$/);
    expect(resolve('src:a.ts@%22the%20docs%22', read).url).toMatch(/\/a\.ts#L6$/);
    expect(resolve('src:a.ts@nope', read).error).toBe("a.ts@nope: no declaration of 'nope'");
  });
});
