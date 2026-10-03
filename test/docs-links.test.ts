/**
 * The documentation URLs oak prints keep resolving, since a printed URL outlives its release.
 * Neither the type checker nor the docs build sees two ways to break one:
 *
 *   1. A page or a `(label)=` target in `docs/` is renamed while `docs-links.ts` names the old
 *      one. The docs build checks only links inside docs/.
 *   2. A docs URL written as a literal, not through `docsUrl(DOCS.x)`, which check 1 cannot see.
 *
 * The table is read as source, not imported, so a topic no message uses yet is checked too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS, docsUrl } from '../src/docs-links.js';
import { DOCS_BASE } from '../src/assets.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const docsDir = join(root, 'docs');
const srcDir = join(root, 'src');

describe('every documentation topic resolves', () => {
  for (const [symbol, topic] of Object.entries(DOCS)) {
    const [page, anchor] = topic.split('#');
    it(`DOCS.${symbol} → ${topic}`, () => {
      const file = join(docsDir, `${page}.md`);
      expect(existsSync(file), `no docs page at docs/${page}.md`).toBe(true);
      if (!anchor) return;
      // An explicit target, not a heading slug, so rewording a heading does not move it.
      const md = readFileSync(file, 'utf8');
      expect(
        md.includes(`(${anchor})=`),
        `docs/${page}.md has no "(${anchor})=" target, either restore it or repoint DOCS.${symbol}`,
      ).toBe(true);
    });
  }

  it('the table is the only place a topic path is written', () => {
    // A literal URL copies the domain and the path, and check 1 cannot see it.
    const offenders: string[] = [];
    for (const name of readdirSync(srcDir)) {
      if (extname(name) !== '.ts' || name === 'docs-links.ts' || name === 'assets.ts') continue;
      const src = readFileSync(join(srcDir, name), 'utf8');
      for (const m of src.matchAll(new RegExp(`${DOCS_BASE}\\S*`, 'g'))) {
        offenders.push(`${name}: ${m[0]}`);
      }
    }
    expect(offenders, `write docsUrl(DOCS.<topic>) instead:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('every DOCS.<symbol> named in source is a real key', () => {
    // A `DOCS.foo` in a comment is not typechecked, so a renamed topic would leave it pointing
    // at nothing.
    const keys = new Set(Object.keys(DOCS));
    const offenders: string[] = [];
    for (const name of readdirSync(srcDir)) {
      if (extname(name) !== '.ts' || name === 'docs-links.ts') continue;
      const src = readFileSync(join(srcDir, name), 'utf8');
      for (const m of src.matchAll(/\bDOCS\.([A-Za-z_$][\w$]*)/g)) {
        if (!keys.has(m[1]!)) offenders.push(`${name}: DOCS.${m[1]}`);
      }
    }
    expect(offenders, `no such key in DOCS:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('every documentation URL written into a new repo resolves', () => {
    // A seeded file is copied into a repo and never updated, so it writes the URL out in full.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) walk(abs);
        else
          for (const m of readFileSync(abs, 'utf8').matchAll(
            new RegExp(`${DOCS_BASE}/([\\w./-]*[\\w-])(?:#([\\w-]+))?`, 'g'),
          )) {
            const file = join(docsDir, `${m[1]}.md`);
            if (!existsSync(file)) offenders.push(`${abs}: no docs page for ${m[0]}`);
            else if (m[2] && !readFileSync(file, 'utf8').includes(`(${m[2]})=`))
              offenders.push(`${abs}: no "(${m[2]})=" target for ${m[0]}`);
          }
      }
    };
    walk(join(root, 'templates'));
    expect(
      offenders,
      `seeded docs links that do not resolve:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('docsUrl joins with exactly one slash, whatever the base looks like', () => {
    expect(docsUrl('guide/checks', 'https://example.org/docs')).toBe(
      'https://example.org/docs/guide/checks',
    );
    expect(docsUrl('guide/checks', 'https://example.org/docs/')).toBe(
      'https://example.org/docs/guide/checks',
    );
  });
});
