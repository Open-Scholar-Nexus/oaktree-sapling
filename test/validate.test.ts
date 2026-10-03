import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkLayout,
  runLayerA,
  splitUnrunnableChecks,
  checkBrandFavicon,
  checkBrandWatermark,
  checkThumbnail,
  checkDepositNames,
  runValidate,
  type FsProbes,
  checkLayerDisjointness,
  expandLayers,
  declaredKeys,
  isFloatingTemplate,
  checkTemplates,
} from '../src/validate.js';
import { CheckStatus, toCheckRun } from '../src/checks.js';
import type { MystEdge } from '../src/build.js';

const instanceRoot = fileURLToPath(new URL('./fixture-instance', import.meta.url));
const allTrue: FsProbes = { existsProbe: () => true, listTree: () => [] };
const allFalse: FsProbes = { existsProbe: () => false, listTree: () => [] };

function edgeReturning(project: unknown, checkResults: unknown[] = []): MystEdge {
  return {
    async loadProject() {
      return project as never;
    },
    async build() {},
    // The real edge processes the project with myst and runs the curvenote checks; the fake
    // returns fixed Layer B results, so the exit codes and how results combine can be tested.
    async withProjectSession() {
      return checkResults as never;
    },
  };
}

describe('checkLayout', () => {
  it('flags a missing index.md', () => {
    const probes: FsProbes = { existsProbe: (p) => p.endsWith('myst.yml'), listTree: () => [] };
    expect(checkLayout('/paper', probes).some((r) => r.message.includes('index.md'))).toBe(true);
  });
  it('flags an extra nested myst.yml', () => {
    const probes: FsProbes = {
      existsProbe: () => true,
      listTree: () => ['myst.yml', 'sub/myst.yml'],
    };
    expect(checkLayout('/paper', probes).some((r) => r.message.includes('extra myst.yml'))).toBe(
      true,
    );
  });
  it('passes a clean layout', () => {
    const probes: FsProbes = { existsProbe: () => true, listTree: () => ['myst.yml', 'index.md'] };
    expect(checkLayout('/paper', probes)).toHaveLength(0);
  });
  it('ignores the directories CI adds (.engine, .git, node_modules)', () => {
    const probes: FsProbes = {
      existsProbe: () => true,
      listTree: () => [
        'myst.yml',
        'index.md',
        '.engine/test/fixture-paper/myst.yml', // oak's checkout under the paper root
        '.engine/templates/paper/myst.yml',
        '.git/whatever',
        'node_modules/pkg/myst.yml',
      ],
    };
    expect(checkLayout('/paper', probes)).toHaveLength(0);
  });
});

describe('checkBrandFavicon [R61]', () => {
  it('warns when no favicon is declared', () => {
    expect(checkBrandFavicon({ instanceRoot: '/i' }, allTrue).ok).toBe(false);
  });
  it('passes a URL favicon (resolves for HTML)', () => {
    expect(checkBrandFavicon({ instanceRoot: '/i', favicon: 'https://x/f.ico' }, allFalse).ok).toBe(
      true,
    );
  });
  it('warns an unresolvable local favicon', () => {
    expect(checkBrandFavicon({ instanceRoot: '/i', favicon: './f.svg' }, allFalse).ok).toBe(false);
  });
  it('passes a resolvable local favicon', () => {
    expect(checkBrandFavicon({ instanceRoot: '/i', favicon: './f.svg' }, allTrue).ok).toBe(true);
  });
});

describe('checkBrandWatermark [R62]', () => {
  it('warns a URL watermark (typst cannot fetch)', () => {
    expect(checkBrandWatermark({ instanceRoot: '/i', logo: 'https://x/w.svg' }, allTrue).ok).toBe(
      false,
    );
  });
  it('passes a resolvable local watermark', () => {
    expect(checkBrandWatermark({ instanceRoot: '/i', logo: './w.svg' }, allTrue).ok).toBe(true);
  });
  it('warns when no watermark is declared', () => {
    expect(checkBrandWatermark({ instanceRoot: '/i' }, allTrue).ok).toBe(false);
  });
});

describe('checkThumbnail [R81]', () => {
  it('passes when no thumbnail is declared (myst uses the first image)', () => {
    expect(checkThumbnail({ paperRoot: '/paper' }, allFalse).ok).toBe(true);
  });
  it('passes a URL thumbnail (myst downloads it for HTML)', () => {
    expect(checkThumbnail({ paperRoot: '/paper', thumbnail: 'https://x/t.png' }, allFalse).ok).toBe(
      true,
    );
  });
  it('warns a declared thumbnail that does not resolve', () => {
    const r = checkThumbnail(
      { paperRoot: '/paper', thumbnail: 'thumbnails/thumbnail.png' },
      allFalse,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe('warn');
  });
  it('passes a resolvable thumbnail, looked up from the paper root', () => {
    const seen: string[] = [];
    const probes: FsProbes = {
      existsProbe: (p) => (seen.push(p), true),
      listTree: () => [],
    };
    expect(
      checkThumbnail({ paperRoot: '/paper', thumbnail: 'thumbnails/thumbnail.png' }, probes).ok,
    ).toBe(true);
    expect(seen).toContain('/paper/thumbnails/thumbnail.png');
  });
});

describe('checkDepositNames [R28]', () => {
  const depositOf = (...entries: string[]): FsProbes => ({
    existsProbe: () => true,
    listTree: (dir) => (dir.endsWith('deposit') ? entries : []),
  });

  it('errors on a deposit/ file oak writes itself', () => {
    const out = checkDepositNames({ paperRoot: '/paper' }, depositOf('data.csv', 'source.zip'));
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('error');
    expect(out[0]!.check).toBe('deposit-names');
    expect(out[0]!.message).toContain('source.zip');
    expect(out[0]!.message).not.toContain('"data.csv"');
  });

  it('covers the conditional template.zip, not just the always-present five', () => {
    expect(checkDepositNames({ paperRoot: '/paper' }, depositOf('template.zip'))).toHaveLength(1);
  });

  it('passes a deposit/ of ordinary supplements, and an absent one', () => {
    expect(checkDepositNames({ paperRoot: '/paper' }, depositOf('data.csv'))).toEqual([]);
    expect(checkDepositNames({ paperRoot: '/paper' }, depositOf())).toEqual([]);
  });

  it('reads the top level only, as the bundle does', () => {
    // A nested path is not uploaded, and a directory with a reserved name is not overwritten.
    const out = checkDepositNames(
      { paperRoot: '/paper' },
      depositOf('sub', 'sub/paper.pdf', 'myst.yml', 'myst.yml/notes.txt'),
    );
    expect(out).toEqual([]);
  });

  it('probes the paper deposit/ folder, not the paper root', () => {
    const seen: string[] = [];
    checkDepositNames(
      { paperRoot: '/paper' },
      { existsProbe: () => true, listTree: (d) => (seen.push(d), []) },
    );
    expect(seen).toEqual([join('/paper', 'deposit')]);
  });
});

describe('isFloatingTemplate: whether a template can change under the same value [R76] [R5]', () => {
  it('treats pinned remote references as fine', () => {
    expect(isFloatingTemplate('https://github.com/o/r/releases/download/v1.2.3/t.zip')).toBe(false);
    expect(isFloatingTemplate('https://github.com/o/r/archive/refs/tags/v1.2.3.zip')).toBe(false);
    expect(isFloatingTemplate('https://github.com/o/r.git#v1.2.3')).toBe(false);
    expect(isFloatingTemplate('https://github.com/o/r.git#a1b2c3d4e5f6')).toBe(false);
  });

  it('flags branch-shaped references', () => {
    expect(isFloatingTemplate('https://github.com/o/isp-lapreprint-typst.git')).toBe(true);
    expect(isFloatingTemplate('https://github.com/o/r/archive/refs/heads/main.zip')).toBe(true);
    expect(isFloatingTemplate('https://github.com/o/r/archive/main.zip')).toBe(true);
    expect(isFloatingTemplate('https://github.com/o/r.git#my-branch')).toBe(true);
  });

  it('treats local paths as fixed', () => {
    expect(isFloatingTemplate('./typst-template')).toBe(false);
    expect(isFloatingTemplate('../shared/typst')).toBe(false);
    expect(isFloatingTemplate('/srv/typst-template')).toBe(false);
  });

  it('treats a template named without a version as unpinned [design §7]', () => {
    expect(isFloatingTemplate('lapreprint-typst')).toBe(true);
  });

  it('says nothing about a remote URL it cannot judge', () => {
    expect(isFloatingTemplate('https://example.org/templates/mine-v1.zip')).toBe(false);
  });
});

describe('checkTemplates [R76]', () => {
  const ids = (f: ReturnType<typeof checkTemplates>) => f.map((x) => x.check);

  it("warns, without failing, when the author's template overrides the journal's", () => {
    const f = checkTemplates(
      { instanceRoot: '/i', authorTemplate: './mine', journalTemplate: './journal' },
      allFalse,
    );
    const override = f.find((x) => x.check === 'template-override')!;
    expect(override.severity).toBe('warn');
    expect(override.message).toMatch(/overriding the journal's/);
  });

  it('says nothing when the author declares one and the journal does not', () => {
    expect(
      ids(checkTemplates({ instanceRoot: '/i', authorTemplate: './mine' }, allFalse)),
    ).not.toContain('template-override');
  });

  it('warns on an unpinned template from either the author or the journal', () => {
    const author = checkTemplates(
      { instanceRoot: '/i', authorTemplate: 'https://github.com/o/r.git' },
      allFalse,
    );
    expect(author.find((x) => x.check === 'template-floating')!.message).toMatch(/author/);
    const journal = checkTemplates(
      { instanceRoot: '/i', journalTemplate: 'https://github.com/o/r.git' },
      allFalse,
    );
    expect(journal.find((x) => x.check === 'template-floating')!.message).toMatch(/journal/);
  });

  it("reports both findings for an unpinned author template that overrides the journal's", () => {
    const f = checkTemplates(
      {
        instanceRoot: '/i',
        authorTemplate: 'https://github.com/o/r.git',
        journalTemplate: './journal',
      },
      allFalse,
    );
    expect(ids(f)).toEqual(expect.arrayContaining(['template-override', 'template-floating']));
    expect(f.every((x) => x.severity === 'warn')).toBe(true);
  });

  it("warns when the journal's template name matches a directory in the journal repo", () => {
    const f = checkTemplates({ instanceRoot: '/i', journalTemplate: 'typst-template' }, allTrue);
    const amb = f.find((x) => x.check === 'template-name-ambiguous')!;
    expect(amb.message).toMatch(/write "\.\/typst-template"/);
  });

  it('does not warn when the value starts with ./', () => {
    const f = checkTemplates({ instanceRoot: '/i', journalTemplate: './typst-template' }, allTrue);
    expect(ids(f)).not.toContain('template-name-ambiguous');
  });
});

describe('runValidate: exit codes with the fixture journal', () => {
  const goodProject = {
    id: 'fixture-2026-sample-paper',
    authors: [{ name: 'Ada Fixture', orcid: '0000-0002-1825-0097', roles: ['software'] }],
    abstract: 'A plain-language abstract.',
    keywords: ['fixtures'],
  };

  it('passes a well-formed paper against the fixture journal (exit 0)', async () => {
    const out = await runValidate(
      { paperRoot: '/paper', instanceRoot, edge: edgeReturning(goodProject) },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    expect(out.exitCode).toBe(0);
    expect(out.status).toBe('ok');
    expect(out.checkRun.conclusion).toBe('success');
  });

  it('fails on the placeholder id and missing editorial fields (exit 1)', async () => {
    const bad = { id: 'fixture-template-placeholder', authors: [], abstract: '', keywords: [] };
    const out = await runValidate(
      { paperRoot: '/paper', instanceRoot, edge: edgeReturning(bad) },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    expect(out.exitCode).toBe(1);
    expect(out.errors.some((e) => e.check === 'id-shape')).toBe(true);
    expect(out.checkRun.conclusion).toBe('failure');
  });

  it('a bad id still runs Layer B and still fails the run (exit 1)', async () => {
    // An id error is `identity`, not `structural`, so myst still processes the paper and the
    // author gets every finding at once.
    const bad = { id: 'fixture-template-placeholder', authors: [], abstract: '', keywords: [] };
    const out = await runValidate(
      {
        paperRoot: '/paper',
        instanceRoot,
        edge: edgeReturning(bad, [
          { id: 'abstract-exists', status: 'fail', message: 'no abstract' },
        ]),
      },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    expect(out.exitCode).toBe(1);
    // Layer B ran despite the bad id,
    expect(out.checks.some((c) => c.id === 'abstract-exists')).toBe(true);
    // and the id error still fails the Check Run.
    expect(out.errors.find((e) => e.check === 'id-shape')?.klass).toBe('identity');
    expect(out.checkRun.conclusion).toBe('failure');
  });

  it('fails on a reserved deposit/ name, and Layer B still runs [R28]', async () => {
    const out = await runValidate(
      {
        paperRoot: '/paper',
        instanceRoot,
        edge: edgeReturning(goodProject, [
          { id: 'abstract-exists', status: 'pass', message: 'ok' },
        ]),
      },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      {
        existsProbe: () => true,
        listTree: (dir) => (dir.endsWith('deposit') ? ['paper.pdf'] : []),
      },
    );
    expect(out.exitCode).toBe(1);
    expect(out.errors.find((e) => e.check === 'deposit-names')?.klass).toBe('config');
    expect(out.checks.some((c) => c.id === 'abstract-exists')).toBe(true);
  });

  it('a failed required editorial check fails the run (exit 1)', async () => {
    const out = await runValidate(
      {
        paperRoot: '/paper',
        instanceRoot,
        edge: edgeReturning(goodProject, [
          { id: 'authors-have-orcid', status: 'fail', message: 'no ORCID' },
        ]),
      },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    expect(out.exitCode).toBe(1);
    expect(out.checkRun.conclusion).toBe('failure');
    expect(out.checks.some((c) => c.id === 'authors-have-orcid' && c.status === 'fail')).toBe(true);
  });

  it('a failed optional editorial check is reported without failing the run (exit 0)', async () => {
    const out = await runValidate(
      {
        paperRoot: '/paper',
        instanceRoot,
        edge: edgeReturning(goodProject, [
          { id: 'authors-have-orcid', status: 'fail', message: 'no ORCID', optional: true },
        ]),
      },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    expect(out.exitCode).toBe(0);
    expect(out.checkRun.conclusion).toBe('success');
  });

  // The edge throws when Layer B runs, as `processProject` does on a project that cannot be
  // processed (a missing index.md, say). Validate still reports.
  const edgeThrowingInLayerB = (project: unknown): MystEdge => ({
    async loadProject() {
      return project as never;
    },
    async build() {},
    async withProjectSession() {
      throw new Error('processProject boom: no valid files');
    },
  });

  it('a Layer A error that stops Layer B fails the run without crashing (exit 1)', async () => {
    // A missing index.md is a layout error, so Layer B is skipped (its edge would throw), and
    // the run resolves with the layout finding.
    const probes: FsProbes = {
      existsProbe: (p) => p.endsWith('myst.yml'),
      listTree: () => ['myst.yml'],
    };
    const out = await runValidate(
      { paperRoot: '/paper', instanceRoot, edge: edgeThrowingInLayerB(goodProject) },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      probes,
    );
    expect(out.exitCode).toBe(1);
    expect(out.errors.some((e) => e.check === 'layout')).toBe(true);
    expect(out.checks).toHaveLength(0);
    expect(out.checkRun.conclusion).toBe('failure');
  });

  it('reports an unexpected Layer B throw as an error (exit 1), without crashing', async () => {
    // Layer A passes but loading the project throws: the editorial checks report an error, and
    // validate does not crash.
    const out = await runValidate(
      { paperRoot: '/paper', instanceRoot, edge: edgeThrowingInLayerB(goodProject) },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    expect(out.exitCode).toBe(1);
    expect(out.checks.some((c) => c.id === 'editorial-checks' && c.status === 'error')).toBe(true);
    expect(out.checkRun.conclusion).toBe('failure');
  });

  it('--no-instance warns without failing; --strict makes it fail', async () => {
    const base = { paperRoot: '/paper', instanceRoot: null, edge: edgeReturning(goodProject) };
    const lax = await runValidate(base, { repo: null }, allTrue);
    expect(lax.exitCode).toBe(0);
    expect(lax.warnings.length).toBeGreaterThan(0);
    const strict = await runValidate(base, { repo: null, strict: true }, allTrue);
    expect(strict.exitCode).toBe(1);
  });

  it('--strict fails the status and Check Run too, not only the exit code [R119]', async () => {
    // A strict run that exits 1 also reports a failure in its status and Check Run.
    const base = { paperRoot: '/paper', instanceRoot: null, edge: edgeReturning(goodProject) };
    const lax = await runValidate(base, { repo: null }, allTrue);
    expect(lax.status).toBe('ok');
    expect(lax.checkRun.conclusion).toBe('success');
    const strict = await runValidate(base, { repo: null, strict: true }, allTrue);
    expect(strict.exitCode).toBe(1);
    expect(strict.status).toBe('error');
    expect(strict.checkRun.conclusion).toBe('failure');
  });
});

describe('checkLayerDisjointness: extends layers must not share keys [R72]', () => {
  const paperBase = {
    project: { thumbnail: 'thumbnails/thumbnail.png', exports: [{ id: 'typst-pdf' }] },
    site: { options: { hide_toc: true } },
  };
  const edition = {
    project: { subject: 'Micropublication', venue: 'Fixture 2026', license: 'CC-BY-4.0' },
  };
  const brand = {
    site: { options: { logo: './logo.svg', favicon: './favicon.svg' }, nav: [] },
    project: { options: { logo: './logo-watermark.svg' } },
  };

  it("passes for oak's own layers", () => {
    expect(
      checkLayerDisjointness([
        { name: 'paper-base.yml', config: paperBase },
        { name: 'editions/x.yml', config: edition },
        { name: 'brand/brand.yml', config: brand },
      ]),
    ).toEqual([]);
  });

  it('does not flag different keys under site.options, which merge key by key [R68]', () => {
    // paper-base sets site.options.hide_toc and brand sets site.options.logo: different keys,
    // since keys are compared leaf by leaf.
    const out = checkLayerDisjointness([
      { name: 'paper-base.yml', config: paperBase },
      { name: 'brand/brand.yml', config: brand },
    ]);
    expect(out).toEqual([]);
  });

  it('flags a real overlap (edition overriding a paper-base default)', () => {
    const greedyEdition = { ...edition, site: { options: { hide_toc: false } } };
    const out = checkLayerDisjointness([
      { name: 'paper-base.yml', config: paperBase },
      { name: 'editions/x.yml', config: greedyEdition },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('error');
    expect(out[0]!.message).toContain('site.options.hide_toc');
    expect(out[0]!.message).toContain('paper-base.yml vs editions/x.yml');
  });

  it('flags a top-level project key declared twice', () => {
    const out = checkLayerDisjointness([
      { name: 'editions/x.yml', config: edition },
      { name: 'brand/brand.yml', config: { project: { license: 'MIT' } } },
    ]);
    expect(out[0]!.message).toContain('project.license');
  });

  it('declaredKeys splits options to leaves but keeps other keys at top level', () => {
    expect(declaredKeys(brand).sort()).toEqual([
      'project.options.logo',
      'site.nav',
      'site.options.favicon',
      'site.options.logo',
    ]);
    expect(declaredKeys(paperBase).sort()).toEqual([
      'project.exports',
      'project.thumbnail',
      'site.options.hide_toc',
    ]);
  });

  it('accepts empty or malformed layers', () => {
    expect(
      checkLayerDisjointness([
        { name: 'a', config: null },
        { name: 'b', config: {} },
      ]),
    ).toEqual([]);
    expect(declaredKeys(undefined)).toEqual([]);
    expect(declaredKeys({ project: 'not-an-object' })).toEqual([]);
  });
});

describe("a layer's own extends: is followed [R119]", () => {
  const realProbes: FsProbes = { existsProbe: (p) => existsSync(p), listTree: () => [] };

  /** An engine + instance pair on disk, with whatever extra layer files the case needs. */
  function layout(files: Record<string, string>): { engineRoot: string; instanceRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'oak-layers-'));
    const engineRoot = join(root, 'engine');
    const instanceRoot = join(root, 'instance');
    mkdirSync(join(instanceRoot, 'editions'), { recursive: true });
    mkdirSync(engineRoot, { recursive: true });
    writeFileSync(join(engineRoot, 'paper-base.yml'), 'project:\n  venue: from-paper-base\n');
    for (const [rel, body] of Object.entries(files)) {
      writeFileSync(join(instanceRoot, rel), body);
    }
    return { engineRoot, instanceRoot };
  }
  const findings = (roots: { engineRoot: string; instanceRoot: string }) =>
    runLayerA(
      {
        paperRoot: '/paper',
        instanceRoot: roots.instanceRoot,
        project: { id: 'x' },
        repo: null,
        engineRoot: roots.engineRoot,
        edition: 'e',
      },
      realProbes,
    );

  it('finds a clash one file of indirection down', () => {
    const f = findings(
      layout({
        'editions/e.yml': 'extends: ./shared.yml\nproject:\n  license: CC-BY-4.0\n',
        'editions/shared.yml': 'project:\n  venue: from-shared\n',
      }),
    ).find((x) => x.check === 'extends-disjoint');
    expect(f?.severity).toBe('error');
    expect(f!.message).toContain('project.venue');
    // named by the file that declared it, not by the layer that pulled it in:
    expect(f!.message).toContain('editions/e.yml -> ./shared.yml');
  });

  it('reports an extends it cannot read rather than skipping it', () => {
    const f = findings(
      layout({ 'editions/e.yml': 'extends: https://example.org/shared.yml\n' }),
    ).find((x) => x.check === 'extends-unreadable');
    expect(f?.severity).toBe('error');
    expect(f!.message).toContain('https://example.org/shared.yml');
  });

  it('reports an extends pointing at a file that is not there', () => {
    const out = findings(layout({ 'editions/e.yml': 'extends: ./gone.yml\n' }));
    expect(out.some((x) => x.check === 'extends-unreadable')).toBe(true);
  });

  it('stays quiet on a clean chain, and terminates on a cyclic one', () => {
    const out = findings(
      layout({
        'editions/e.yml': 'extends:\n  - ./a.yml\n',
        'editions/a.yml': 'extends: ./e.yml\nproject:\n  license: CC-BY-4.0\n',
      }),
    );
    expect(out.some((x) => x.check.startsWith('extends-'))).toBe(false);
  });

  it('expandLayers takes each root and its chain, in order', () => {
    const { engineRoot, instanceRoot } = layout({
      'editions/e.yml': 'extends: ./shared.yml\n',
      'editions/shared.yml': 'project:\n  venue: v\n',
    });
    const { layers, unreadable } = expandLayers(
      [
        { name: 'paper-base.yml', path: join(engineRoot, 'paper-base.yml') },
        { name: 'editions/e.yml', path: join(instanceRoot, 'editions', 'e.yml') },
        { name: 'brand/brand.yml', path: join(instanceRoot, 'brand', 'brand.yml') },
      ],
      realProbes,
    );
    expect(layers.map((l) => l.name)).toEqual([
      'paper-base.yml',
      'editions/e.yml',
      'editions/e.yml -> ./shared.yml',
    ]);
    expect(unreadable).toEqual([]);
  });
});

describe("the author's template is read from their myst.yml, not from the composed project [R82]", () => {
  // In the composed config the typst export always has a template (compose sets `flag ??
  // author ?? journal ?? oak`), so read from there every paper would seem to override the
  // journal's template.
  const composedProject = {
    id: 'j-2026-x',
    exports: [{ format: 'typst', id: 'typst-pdf', template: '/engine/templates/typst' }],
  };
  const tmpDir = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-lift-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  };
  const journalInstance = () => {
    // `allTrue` says every path exists, so the journal repo must really hold the files
    // runLayerA reads (journal.yml and the registry), or the read throws first.
    const dir = tmpDir({ 'journal.yml': 'name: J\ntypst_template: ./journal-template\n' });
    mkdirSync(join(dir, 'registry'), { recursive: true });
    writeFileSync(join(dir, 'registry', 'papers.yml'), '[]\n');
    return dir;
  };

  it('does not report template-override when the paper declares no template', () => {
    const paperRoot = tmpDir({ 'myst.yml': 'version: 1\nproject:\n  id: j-2026-x\n' });
    const findings = runLayerA(
      { paperRoot, instanceRoot: journalInstance(), project: composedProject, repo: null },
      allTrue,
    );
    expect(findings.some((f) => f.check === 'template-override')).toBe(false);
  });

  it('reports template-override when the author declares one in their myst.yml', () => {
    const paperRoot = tmpDir({
      'myst.yml':
        'version: 1\nproject:\n  id: j-2026-x\n  exports:\n    - format: typst\n      id: typst-pdf\n      template: ./mine\n',
    });
    const findings = runLayerA(
      { paperRoot, instanceRoot: journalInstance(), project: composedProject, repo: null },
      allTrue,
    );
    expect(findings.some((f) => f.check === 'template-override')).toBe(true);
  });
});

describe('splitUnrunnableChecks: a check that cannot run yet is reported, not run [R82]', () => {
  const selected = [{ id: 'authors-exist' }, { id: 'exports-exist' }];

  it('holds exports-exist back when there are no build artifacts, with a cause', () => {
    const { runnable, unrunnable } = splitUnrunnableChecks(selected, '/paper', allFalse);
    expect(runnable.map((c) => c.id)).toEqual(['authors-exist']);
    expect(unrunnable).toHaveLength(1);
    expect(unrunnable[0]!.status).toBe(CheckStatus.error); // no `skip` in the enum
    expect(unrunnable[0]!.message).toMatch(/requires build artifacts/);
  });

  it('runs everything once _build/exports is there', () => {
    const { runnable, unrunnable } = splitUnrunnableChecks(selected, '/paper', allTrue);
    expect(runnable).toHaveLength(2);
    expect(unrunnable).toEqual([]);
  });

  it('marks it optional even when the journal made it required', () => {
    // `_build/exports` never exists in CI (check.yml has no build step), so a blocking result
    // here would fail every pull request of every paper, and only the journal could fix it. It
    // would also pass locally, where an earlier build left the directory.
    const { unrunnable } = splitUnrunnableChecks([{ id: 'exports-exist' }], '/paper', allFalse);
    expect(unrunnable[0]!.optional).toBe(true);
    expect(toCheckRun(unrunnable).conclusion).toBe('success');
  });
});

describe('runValidate: when there is nothing to compose [R82]', () => {
  it('still reports, and says it ran uncomposed', async () => {
    const out = await runValidate(
      {
        paperRoot: '/paper',
        instanceRoot,
        edge: edgeReturning({ id: 'fixture-2026-sample-paper' }),
      },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    // No engineRoot, so nothing to compose. The report says so once, so two runs of the same
    // command do not differ silently [R71].
    expect(out.notes.some((n) => /own myst\.yml ONLY/.test(n))).toBe(true);
    expect(out.checkRun).toBeDefined();
    // It reaches the pull request too, not just stdout.
    expect(out.checkRun.summary).toMatch(/⚠️ checked the paper's own myst\.yml ONLY/);
    // Nothing to compose is the user's choice (--no-instance, or a local run), so the note
    // explains and does not block. A failed compose, below, does block.
    expect(out.errors.some((e) => e.check === 'compose')).toBe(false);
  });

  it('a failed compose fails the run, not only a note', async () => {
    // With oak's checkout and the journal repo both present, a throw means the paper's own
    // config broke compose: a mistyped `edition:`, a missing version key, the [R36] check.
    // `oak build` throws the same way, so this blocks the merge.
    // A real paper root: materializeDerived reads the author's myst.yml from disk, with its
    // version key, before the edge is used.
    const paperRoot = mkdtempSync(join(tmpdir(), 'oak-compose-fail-'));
    writeFileSync(
      join(paperRoot, 'myst.yml'),
      'version: 1\nproject:\n  id: fixture-2026-sample-paper\n  options:\n' +
        '    oaktree-sapling:\n      version: v0.0.0-dev.1\n      edition: typo\n',
    );
    const edge: MystEdge = {
      // How myst fails on a missing `extends:` entry, such as a mistyped edition.
      loadProject: async (_dir: string, configFile?: string) => {
        if (configFile) throw new Error('Cannot find config file: editions/typo.yml');
        return { id: 'fixture-2026-sample-paper' };
      },
      build: async () => {},
      withProjectSession: async (_dir, fn) => fn({} as never),
    };
    const out = await runValidate(
      { paperRoot, instanceRoot, edge, engineRoot: '/engine', edition: 'typo' },
      { repo: 'open-scholar-nexus/fixture-sample-paper' },
      allTrue,
    );
    const compose = out.errors.find((e) => e.check === 'compose');
    expect(compose?.severity).toBe('error');
    expect(compose?.klass).toBe('config'); // not `structural`, so Layer B still runs
    expect(compose?.message).toMatch(/editions\/typo\.yml/);
    expect(out.status).toBe('error');
    expect(out.exitCode).toBe(1);
    expect(out.checkRun.conclusion).toBe('failure');
    // The note says why the other results cover less than usual.
    expect(out.notes.some((n) => /own myst\.yml ONLY/.test(n))).toBe(true);
  });
});

describe('a journal.yml that cannot be read fails the run [R116]', () => {
  // Every rule the gate enforces is read from journal.yml ([R116]).
  // Denies papers.yml too, since loadRegistry reads whatever the probe admits [R119].
  const noJournal: FsProbes = {
    existsProbe: (p: string) => !p.endsWith('journal.yml') && !p.endsWith('papers.yml'),
    listTree: () => [],
  };
  const layerA = (instanceRoot: string | null, probes: FsProbes) =>
    runLayerA(
      {
        paperRoot: '/paper',
        instanceRoot,
        project: { id: 'anything-at-all' },
        repo: null,
        engineRoot: null,
        edition: null,
      },
      probes,
    );

  it('fails when the journal repo has no journal.yml', () => {
    const f = layerA('/instance', noJournal).find((x) => x.check === 'journal-config');
    expect(f, 'a missing journal.yml must be reported').toBeTruthy();
    expect(f!.severity).toBe('error');
  });

  it('says nothing with --no-instance', () => {
    // --no-instance is the user's choice, not a broken journal repo.
    expect(layerA(null, noJournal).some((x) => x.check === 'journal-config')).toBe(false);
  });
});

describe('the id policy cannot be turned off by the journal [R119]', () => {
  const journalOf = (yaml: string, dir: string) => {
    writeFileSync(join(dir, 'journal.yml'), yaml);
    return {
      existsProbe: (p: string) => p.endsWith('journal.yml'),
      listTree: () => [],
    } satisfies FsProbes;
  };
  const layerA = (id: string, root: string | null, probes: FsProbes) =>
    runLayerA({ paperRoot: '/paper', instanceRoot: root, project: { id }, repo: null }, probes);

  it('warns when the journal declares no id_pattern', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-idpolicy-'));
    const found = layerA('anything-at-all', dir, journalOf('name: J\n', dir)).find(
      (f) => f.check === 'id-policy',
    );
    expect(found?.severity).toBe('warn');
  });

  it('says nothing when the journal declares one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-idpolicy-'));
    const probes = journalOf('name: J\nid_pattern: "^p-"\n', dir);
    expect(layerA('p-x', dir, probes).some((f) => f.check === 'id-policy')).toBe(false);
  });

  it('says nothing without a journal repo, which holds the policy [R116]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-idpolicy-'));
    const probes = journalOf('name: J\n', dir);
    expect(layerA('anything-at-all', null, probes).some((f) => f.check === 'id-policy')).toBe(
      false,
    );
  });

  it('still rejects the placeholder id with both keys deleted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-idpolicy-'));
    const found = layerA('CHANGE-ME-template-placeholder', dir, journalOf('name: J\n', dir)).find(
      (f) => f.check === 'id-shape',
    );
    expect(found?.severity).toBe('error');
  });
});
