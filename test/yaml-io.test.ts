import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readDoc,
  setExtends,
  applyOwnOverride,
  readEngineCoordinateRaw,
  readBrandAssetOptions,
  readJournalTypstTemplate,
} from '../src/yaml-io.js';

const fixturePaper = fileURLToPath(new URL('./fixture-paper/myst.yml', import.meta.url));
const fixtureInstance = fileURLToPath(new URL('./fixture-instance', import.meta.url));

describe('readEngineCoordinateRaw (local yq equivalent, §6a)', () => {
  it('reads version + edition from the raw doc, pre-extends', () => {
    const c = readEngineCoordinateRaw(readDoc(fixturePaper));
    expect(c).toEqual({ version: 'v0.3.0', edition: 'fixture-edition' });
  });

  it('throws clearly when the coordinate is absent, naming the file and the fix', () => {
    const doc = parseDocument('version: 1\nproject:\n  id: x\n');
    // A UserError, printed as a sentence without a stack.
    expect(() => readEngineCoordinateRaw(doc, '/papers/one/myst.yml')).toThrow(
      /\/papers\/one\/myst\.yml has no engine version/,
    );
    expect(() => readEngineCoordinateRaw(doc, '/papers/one/myst.yml')).toThrow(
      /project\.options\.oaktree-sapling/,
    );
  });

  it('refuses an edition holding a path before it reaches the extends chain [R141]', () => {
    // This is read before anything validates the merged config, so the schema check alone
    // would come too late to stop a path in the edition.
    for (const bad of ['../../secret/loot', './x', 'a/b']) {
      const doc = parseDocument(
        `version: 1\nproject:\n  options:\n    oaktree-sapling:\n      version: v1\n      edition: ${bad}\n`,
      );
      expect(() => readEngineCoordinateRaw(doc, '/p/myst.yml'), bad).toThrow(/plain name/);
    }
  });
});

describe('working-tree injection preserves author content ([R3])', () => {
  it('sets extends + overrides without disturbing options.youtube or comments', () => {
    const doc = readDoc(fixturePaper);
    setExtends(doc, ['.engine/paper-base.yml', '.instance/editions/fixture-edition.yml']);
    applyOwnOverride(doc, {
      project: {
        exports: [
          {
            id: 'typst-pdf',
            format: 'typst',
            articles: [{ file: 'index.md', level: 0 }],
            template: 'https://example.org/typst-template.zip',
          },
        ],
      },
      site: { template: 'https://example.org/book-theme.zip' },
    });

    const out = parseDocument(doc.toString());
    expect(out.getIn(['extends', 0])).toBe('.engine/paper-base.yml');
    expect(out.getIn(['project', 'exports', 0, 'template'])).toBe(
      'https://example.org/typst-template.zip',
    );
    expect(out.getIn(['site', 'template'])).toBe('https://example.org/book-theme.zip');
    // the author's `youtube` option is kept
    expect(out.getIn(['project', 'options', 'youtube'])).toBe('https://youtu.be/dQw4w9WgXcQ');
    // and the version key the engine action reads is still there
    expect(readEngineCoordinateRaw(out)).toEqual({
      version: 'v0.3.0',
      edition: 'fixture-edition',
    });
    // a comment from the original file is kept
    expect(doc.toString()).toContain('# Fixture paper');
  });

  it('sets brand assets key by key under site and project options, keeping the others [R62]', () => {
    const doc = readDoc(fixturePaper);
    applyOwnOverride(doc, {
      project: { options: { logo: '/abs/instance/brand/logo-watermark.svg' } },
      site: {
        template: 'https://example.org/book-theme.zip',
        options: { logo: '/abs/instance/brand/logo.svg', favicon: '/abs/instance/brand/f.svg' },
      },
    });

    const out = parseDocument(doc.toString());
    expect(out.getIn(['site', 'template'])).toBe('https://example.org/book-theme.zip');
    expect(out.getIn(['site', 'options', 'logo'])).toBe('/abs/instance/brand/logo.svg');
    expect(out.getIn(['site', 'options', 'favicon'])).toBe('/abs/instance/brand/f.svg');
    // the typst watermark lands in project.options.logo
    expect(out.getIn(['project', 'options', 'logo'])).toBe(
      '/abs/instance/brand/logo-watermark.svg',
    );
    // the author's other project options are kept
    expect(out.getIn(['project', 'options', 'youtube'])).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(out.getIn(['project', 'options', 'oaktree-sapling', 'version'])).toBe('v0.3.0');
  });
});

describe('readBrandAssetOptions ([R62])', () => {
  it("reads the asset fields from the journal's brand.yml, for site and project", () => {
    // the fixture brand has a relative site logo and favicon, and a typst watermark
    expect(readBrandAssetOptions(fixtureInstance)).toEqual({
      site: { logo: './logo.svg', favicon: './favicon.svg' },
      project: { logo: './logo-watermark.svg' },
    });
  });

  it('returns empty maps when the journal repo has no brand.yml', () => {
    expect(readBrandAssetOptions('/no/such/instance')).toEqual({ site: {}, project: {} });
  });
});

describe('readJournalTypstTemplate ([R76])', () => {
  /** A temporary journal repo. The shared fixture sets no journal template, so the fixture
   *  builds use oak's. */
  function instanceWithJournal(body: string): string {
    const root = mkdtempSync(join(tmpdir(), 'oak-journal-'));
    writeFileSync(join(root, 'journal.yml'), body);
    return root;
  }

  it('lifts the journal.yml value raw, never through the extends merge', () => {
    const root = instanceWithJournal('name: J\ntypst_template: ./typst-template\n');
    expect(readJournalTypstTemplate(root)).toBe('./typst-template');
  });

  it('returns undefined when the journal declares none (the common case)', () => {
    expect(readJournalTypstTemplate(instanceWithJournal('name: J\n'))).toBeUndefined();
    expect(readJournalTypstTemplate(fixtureInstance)).toBeUndefined();
  });

  it('returns undefined when there is no journal.yml at all', () => {
    expect(readJournalTypstTemplate('/no/such/instance')).toBeUndefined();
  });
});
