#!/usr/bin/env node
/**
 * Builds the test paper in test/fixture-paper to a PDF with the bundled CLI (dist/cli.cjs)
 * and the typst template in templates/typst, offline.
 *
 *   npm run build:fixture              # build the PDF
 *   npm run build:fixture -- --keep    # keep the temp dir
 *
 * The paper is copied to a temp dir first, because the build writes into the paper folder.
 */
import { mkdtempSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const engineDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(engineDir, 'dist', 'cli.cjs');
if (!existsSync(bundle)) {
  console.error('dist/cli.cjs missing, run `npm run bundle` first.');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'oak-fixture-'));
for (const f of ['myst.yml', 'index.md', 'bib.bib']) {
  copyFileSync(join(engineDir, 'test', 'fixture-paper', f), join(tmp, f));
}

console.error(`Building fixture in ${tmp} (engine template: templates/typst)\n`);
execFileSync(
  'node',
  [
    bundle,
    'build',
    '--paper',
    tmp,
    '--instance',
    join(engineDir, 'test', 'fixture-instance'),
    '--exports-only', // PDF only: the HTML export needs a theme downloaded from the network
  ],
  // The fixture pins another version, so this oak builds it itself (handOff in src/pinned.ts).
  { stdio: 'inherit', env: { ...process.env, OAK_USE_RUNNING: '1' } },
);

// Finds the PDF by extension. The exact output path (TYPST_OUTPUT) is asserted in
// test/integration.test.ts, which can import the constant; this plain .mjs cannot.
const exportsDir = join(tmp, '_build', 'exports');
const pdf = existsSync(exportsDir)
  ? readdirSync(exportsDir, { recursive: true })
      .map(String)
      .find((f) => f.endsWith('.pdf'))
  : undefined;
// A release gate: a build that exits 0 without a PDF fails here [R67].
if (!pdf) {
  console.error('\nPDF: not produced; the build exited 0 without rendering one');
  process.exit(1);
}
console.error(`\nPDF: ${join(exportsDir, pdf)}`);
if (!process.argv.includes('--keep')) {
  console.error('(pass --keep to retain the temp dir)');
}
