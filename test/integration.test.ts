/**
 * Builds the fixture paper through the bundled CLI before a release is cut [design §12]. It runs
 * `node dist/cli.cjs`, since myst-cli crashes unbundled on Node 24 [R51], so it runs what the
 * paper workflows run.
 *
 * Skipped unless the bundle, typst and oak's template are all present, so `npm test` runs
 * anywhere. The release script bundles first, then this must pass.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { DERIVED_CONFIG_FILE } from '../src/yaml-io.js';
import { TYPST_OUTPUT } from '../src/compose.js';
import { bundleState, assertBundleNotStale } from './bundle-state.js';
import { readFileSync } from 'node:fs';

const engineDir = fileURLToPath(new URL('..', import.meta.url));
const bundle = join(engineDir, 'dist', 'cli.cjs');
const template = join(engineDir, 'templates', 'typst');

function typstPresent(): boolean {
  try {
    execFileSync('typst', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// No bundle skips; a stale bundle fails in beforeAll (bundle-state.ts).
const runnable = bundleState() !== 'absent' && existsSync(template) && typstPresent();

describe.skipIf(!runnable)('fixture build through the bundled CLI', () => {
  beforeAll(assertBundleNotStale);
  it("renders a real PDF with the articles and oak's template", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oak-int-'));
    for (const f of ['myst.yml', 'index.md', 'bib.bib']) {
      copyFileSync(join(engineDir, 'test', 'fixture-paper', f), join(tmp, f));
    }

    const authorBefore = readFileSync(join(tmp, 'myst.yml')); // the bytes before the build

    execFileSync(
      'node',
      [
        bundle,
        'build',
        '--paper',
        tmp,
        '--instance',
        join(engineDir, 'test', 'fixture-instance'),
        // Offline: the PDF and compose only. The HTML site needs the theme from the network,
        // so conformance tests it.
        '--exports-only',
      ],
      { stdio: 'pipe' },
    );

    // a real PDF at the path oak sets in `output`
    expect(existsSync(join(tmp, TYPST_OUTPUT))).toBe(true);
    // and nothing else in exports
    expect(readdirSync(join(tmp, '_build', 'exports'))).toEqual(['paper.pdf']);

    // The author's myst.yml is unchanged [R71].
    expect(readFileSync(join(tmp, 'myst.yml')).equals(authorBefore)).toBe(true);

    // The full typst entry (articles and oak's template) is in myst.oak.yml.
    const doc = parseDocument(readFileSync(join(tmp, DERIVED_CONFIG_FILE), 'utf8'));
    expect(doc.getIn(['project', 'exports', 0, 'template'])).toBe(template);
    // the articles are kept [R53]
    expect(doc.getIn(['project', 'exports', 0, 'articles', 0, 'file'])).toBe('index.md');
    expect(doc.getIn(['project', 'exports', 0, 'output'])).toBe(TYPST_OUTPUT);
    // the author's `youtube` option is kept
    expect(doc.getIn(['project', 'options', 'youtube'])).toBe('https://youtu.be/dQw4w9WgXcQ');
  }, 60_000);
});
