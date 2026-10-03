/**
 * Keeps the printed wording in `src/messages.ts`, so it can be reviewed in one file. Fails when
 * a module hands a string literal straight to output: a `write` or `log` call, or a `message:`,
 * `error:` or `reason:` field of a result. A message built from variables gets past it; a
 * `log('  ✓ done')` does not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(fileURLToPath(new URL('..', import.meta.url)), 'src');

/**
 * The modules whose output people read. `conformance.ts` and `zenodo.ts` are left out, as the
 * messages.ts header says.
 */
const COVERED = [
  'cli.ts',
  'bootstrap.ts',
  'upgrade.ts',
  'build.ts',
  'validate.ts',
  'checks.ts',
  'preview.ts',
  'schema.ts',
  'compose.ts',
  'gh.ts',
  'yaml-io.ts',
];

/** A sink that puts its argument in front of a person. */
const SINKS =
  /(?:stderr\.write|stdout\.write|\blog|\bwarn|\bemit)\(\s*(['"`])|(?:message|error|reason|title|body|description)\s*:\s*(['"`])/g;

/** Prose is a literal with whitespace in it; `'main'`, `'ok'`, `'v*'` are identifiers. */
function isProse(quote: string, rest: string): boolean {
  const end = rest.indexOf(quote);
  const literal = end === -1 ? rest : rest.slice(0, end);
  return /\S\s+\S/.test(literal) && literal.length > 12;
}

/** Literals that are not prose, each with its reason. */
const ALLOWED = [
  // a bug in oak, reached only when oak's own package.json is broken
  'bootstrap: engine package.json declares no myst-cli dependency',
];

describe('every printed string lives in messages.ts', () => {
  for (const file of COVERED) {
    it(`${file} hands no prose literal straight to an output sink`, () => {
      const src = readFileSync(join(srcDir, file), 'utf8');
      const offenders: string[] = [];
      for (const m of src.matchAll(SINKS)) {
        const quote = m[1] ?? m[2]!;
        const rest = src.slice(m.index! + m[0].length);
        if (!isProse(quote, rest)) continue;
        const literal = rest.slice(0, rest.indexOf(quote));
        if (ALLOWED.some((a) => literal.includes(a))) continue;
        offenders.push(literal.slice(0, 80));
      }
      expect(offenders, `move these into src/messages.ts:\n  ${offenders.join('\n  ')}`).toEqual(
        [],
      );
    });
  }

  it('no design-doc jargon is printed (rule 2)', () => {
    // Enforces rule 2 of the messages.ts header [R151]. Comments are removed first, or a
    // string match could span a comment and report its `[R#]`.
    const src = readFileSync(join(srcDir, 'messages.ts'), 'utf8');
    const code = src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    const strings = code.match(/'[^'\n]*'|`[^`\n]*`|"[^"\n]*"/g) ?? [];
    const banned = /\[[RS]\d+\]|frozen shim|build_type|instance-config/;
    expect(strings.filter((x) => banned.test(x))).toEqual([]);
  });

  it('names every workflow the paper template ships', () => {
    // The header lists every workflow the paper template ships.
    const src = readFileSync(join(srcDir, 'messages.ts'), 'utf8');
    const header = src.slice(0, src.indexOf('*/'));
    for (const w of readdirSync(join(srcDir, '../templates/paper/.github/workflows'))) {
      expect(header, w).toContain(w.replace(/\.yml$/, ''));
    }
  });

  it('messages.ts names the printed text it does not hold', () => {
    // The file says where the rest of the printed text lives.
    const src = readFileSync(join(srcDir, 'messages.ts'), 'utf8');
    for (const pointer of [
      'templates/paper/README.md',
      'templates/instance/journal.yml',
      'plugins/gallery.mjs',
    ]) {
      expect(src).toContain(pointer);
    }
  });
});
