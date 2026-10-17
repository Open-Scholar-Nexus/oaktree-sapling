/**
 * A deposit renders its PDF again from its own files [R66]: the fixture paper is built from
 * three git checkouts (oak, the journal, the paper), deposited with the real git side, then
 * rebuilt from the unzipped `engine.zip`, `journal.zip` and `source.zip` with nothing fetched.
 * The journal moves on between the build and the deposit, as the default branch can in CI, so
 * this also checks that `journal.zip` holds the commit the build used.
 *
 * The rebuild is skipped unless the bundle, typst and oak's template are all present, like
 * `test/integration.test.ts`. `journalStamp`, which records that commit, needs only git.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { parseDocument } from 'yaml';
import { journalStamp, realGitContext } from '../src/gh.js';
import { buildBundle, prepareJournalArchive, type BundleProvenance } from '../src/zenodo.js';
import { readJournalStamp, DERIVED_CONFIG_FILE } from '../src/yaml-io.js';
import { TYPST_OUTPUT } from '../src/compose.js';
import { bundleState, assertBundleNotStale, bundlePath } from './bundle-state.js';

const engineDir = fileURLToPath(new URL('..', import.meta.url));
const template = join(engineDir, 'templates', 'typst');

function typstPresent(): boolean {
  try {
    execFileSync('typst', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const runnable = bundleState() !== 'absent' && existsSync(template) && typstPresent();

const GIT_ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.org'];

function commitAll(dir: string, message: string): void {
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, ...GIT_ID, 'commit', '-q', '-m', message]);
}

function repoOf(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['-C', dir, 'init', '-q']);
  return dir;
}

/** A checkout of oak as a release tag holds it: the bundle, the template, `bin/typst`. */
function engineCheckout(dir: string): void {
  repoOf(dir);
  for (const f of ['paper-base.yml', 'typst.version'])
    copyFileSync(join(engineDir, f), join(dir, f));
  mkdirSync(join(dir, 'dist'));
  copyFileSync(bundlePath, join(dir, 'dist', 'cli.cjs'));
  cpSync(template, join(dir, 'templates', 'typst'), { recursive: true });
  // The PDF export uses the system typst here; the file only has to be in engine.zip.
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'typst'), '');
  commitAll(dir, 'release');
}

/** `oak build --exports-only`: the PDF only, offline. */
function build(engine: string, paper: string, journal: string): void {
  execFileSync(
    'node',
    [
      join(engine, 'dist', 'cli.cjs'),
      'build',
      '--paper',
      paper,
      '--instance',
      journal,
      '--exports-only',
    ],
    { stdio: 'pipe' },
  );
}

/** The derived config's `extends:` chain and brand assets, with `roots` written as names, so
 *  two builds from different directories compare. */
function composed(paper: string, roots: Record<string, string>): unknown {
  let text = readFileSync(join(paper, DERIVED_CONFIG_FILE), 'utf8');
  for (const [name, root] of Object.entries(roots)) text = text.split(root).join(`<${name}>`);
  const config = parseDocument(text).toJS();
  return {
    extends: config.extends,
    site: config.site.options,
    watermark: config.project.options.logo,
    template: config.project.exports[0].template,
  };
}

describe('journalStamp', () => {
  it('names the commit of a clean journal checkout', () => {
    const journal = repoOf(mkdtempSync(join(tmpdir(), 'oak-stamp-')));
    writeFileSync(join(journal, 'journal.yml'), 'name: J\n');
    commitAll(journal, 'journal');
    const head = execFileSync('git', ['-C', journal, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    expect(journalStamp(journal, '/paper')).toEqual({ repo: null, commit: head.trim() });
    writeFileSync(join(journal, 'logo.svg'), '<svg/>'); // untracked, so left out of an archive
    expect(journalStamp(journal, '/paper')).toEqual({ repo: null, commit: null });
  });

  it('tells no journal, the paper itself, and a folder outside git apart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-stamp-'));
    expect(journalStamp(null, dir)).toBeUndefined();
    expect(journalStamp(dir, dir)).toEqual({ repo: '.' });
    expect(journalStamp(dir, '/paper')).toEqual({ repo: null, commit: null });
  });

  it('fetches only a full commit id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-stamp-'));
    await expect(realGitContext.fetchCommit(dir, '--upload-pack=x')).rejects.toThrow(
      'not a full commit id',
    );
  });
});

describe.skipIf(!runnable)('rebuilding the PDF from a deposit', () => {
  beforeAll(assertBundleNotStale);
  it('renders from the unzipped engine.zip, journal.zip and source.zip alone', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oak-rebuild-'));
    const engine = join(tmp, 'engine');
    const journal = join(tmp, 'journal');
    const paper = join(tmp, 'paper');
    engineCheckout(engine);
    repoOf(journal);
    cpSync(join(engineDir, 'test', 'fixture-instance'), journal, { recursive: true });
    commitAll(journal, 'journal');
    repoOf(paper);
    for (const f of ['myst.yml', 'index.md', 'bib.bib']) {
      copyFileSync(join(engineDir, 'test', 'fixture-paper', f), join(paper, f));
    }
    // An author's own stamp, which the build drops.
    const myst = parseDocument(readFileSync(join(paper, 'myst.yml'), 'utf8'));
    myst.setIn(['project', 'options', 'oaktree-sapling', 'journal'], { repo: 'o/x', commit: null });
    writeFileSync(join(paper, 'myst.yml'), myst.toString());
    commitAll(paper, 'paper');
    const journalHead = execFileSync('git', ['-C', journal, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    build(engine, paper, journal);
    expect(readJournalStamp(paper)).toEqual({ repo: null, commit: journalHead });
    const derived = parseDocument(readFileSync(join(paper, DERIVED_CONFIG_FILE), 'utf8'));
    expect(derived.getIn(['project', 'options', 'oaktree-sapling', 'version'])).toBe('v0.3.0');
    expect(derived.getIn(['project', 'options', 'oaktree-sapling', 'edition'])).toBe(
      'fixture-edition',
    );
    const builtLogo = readFileSync(join(journal, 'brand', 'logo-watermark.svg'), 'utf8');

    // The journal's default branch moves on before the deposit job runs.
    writeFileSync(join(journal, 'brand', 'logo-watermark.svg'), '<svg>later</svg>');
    commitAll(journal, 'a later logo');

    const archive = await prepareJournalArchive(paper, journal, realGitContext);
    const provenance = { repo: 'o/r' } as BundleProvenance;
    const out = join(tmp, 'deposit');
    await buildBundle(
      out,
      join(paper, TYPST_OUTPUT),
      paper,
      engine,
      provenance,
      realGitContext,
      archive,
    );
    expect(existsSync(join(out, DERIVED_CONFIG_FILE))).toBe(true);

    const r = join(tmp, 'rebuilt');
    for (const [zip, dir] of [
      ['engine.zip', 'engine'],
      ['journal.zip', 'journal'],
      ['source.zip', 'paper'],
    ] as const) {
      new AdmZip(join(out, zip)).extractAllTo(join(r, dir));
    }
    expect(readFileSync(join(r, 'journal', 'brand', 'logo-watermark.svg'), 'utf8')).toBe(builtLogo);

    build(join(r, 'engine'), join(r, 'paper'), join(r, 'journal'));
    expect(existsSync(join(r, 'paper', TYPST_OUTPUT))).toBe(true);
    const original = composed(paper, { engine, journal });
    expect(original).toMatchObject({
      extends: [
        '<engine>/paper-base.yml',
        '<journal>/editions/fixture-edition.yml',
        '<journal>/brand/brand.yml',
      ],
      watermark: '<journal>/brand/logo-watermark.svg',
    });
    expect(
      composed(join(r, 'paper'), { engine: join(r, 'engine'), journal: join(r, 'journal') }),
    ).toEqual(original);
  }, 120_000);
});
