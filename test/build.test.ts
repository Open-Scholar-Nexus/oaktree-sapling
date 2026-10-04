import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  copyFileSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { runBuild, runStart, type MystEdge } from '../src/build.js';
import { UserError } from '../src/messages.js';
import { DERIVED_CONFIG_FILE } from '../src/yaml-io.js';
import type { ResolvedProject } from '../src/compose.js';
import { typstTemplateUrl, themeZipUrl } from '../src/assets.js';
import { TYPST_OUTPUT } from '../src/compose.js';

const fixturePaper = fileURLToPath(new URL('./fixture-paper/myst.yml', import.meta.url));

/** A copy of the fixture paper in a temporary directory, so the build does not change it. */
function tmpPaper(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oak-build-'));
  copyFileSync(fixturePaper, join(dir, 'myst.yml'));
  writeFileSync(join(dir, 'index.md'), '# Fixture\n');
  return dir;
}

/** A fake edge: loadProject returns what loadConfig would after `extends` (a typst export with
 *  articles from the edition, and a `youtube` option beside ours), and records the build call. */
function fakeEdge(): { edge: MystEdge; calls: string[] } {
  const calls: string[] = [];
  const resolved: ResolvedProject = {
    id: 'fixture-2026-sample-paper',
    title: 'A Fixture Paper',
    options: {
      youtube: 'https://youtu.be/x',
      'oaktree-sapling': { version: 'v0.3.0', edition: 'fixture-edition' },
    },
    exports: [{ id: 'typst-pdf', format: 'typst', articles: [{ file: 'index.md', level: 0 }] }],
  };
  return {
    calls,
    edge: {
      async loadProject(_dir, configFile) {
        calls.push(`load:${configFile}`);
        return resolved;
      },
      async build(_dir, opts, configFile) {
        calls.push(`build:${opts.all}:${opts.html}:${configFile}`);
      },
      async start(dir, opts, configFile) {
        calls.push(`start:${dir}:${JSON.stringify(opts)}:${configFile}`);
      },
    },
  };
}

describe('runBuild: the two-pass orchestrator ([R52])', () => {
  it("writes extends, then oak's settings, into myst.oak.yml, then builds", async () => {
    const paperRoot = tmpPaper();
    const { edge, calls } = fakeEdge();

    const res = await runBuild({
      paperRoot,
      engineRoot: '.engine',
      instanceRoot: '.instance',
      engineRepo: 'open-scholar-nexus/oaktree-sapling',
      baseUrl: '/fixture-sample-paper',
      edge,
    });

    // pass 1 (resolve) runs before pass 2 (build)
    // both passes read myst.oak.yml, never the author's myst.yml [R71]
    expect(calls).toEqual([
      `load:${DERIVED_CONFIG_FILE}`,
      `build:true:true:${DERIVED_CONFIG_FILE}`,
    ]);

    const doc = parseDocument(readFileSync(join(paperRoot, DERIVED_CONFIG_FILE), 'utf8'));
    // extends chain written in pass 1
    expect(doc.getIn(['extends', 0])).toBe('.engine/paper-base.yml');
    expect(doc.getIn(['extends', 1])).toBe('.instance/editions/fixture-edition.yml');
    expect(doc.getIn(['extends', 2])).toBe('.instance/brand/brand.yml');
    // the full typst entry in myst.oak.yml (release URL, articles kept)
    expect(doc.getIn(['project', 'exports', 0, 'template'])).toBe(
      typstTemplateUrl('open-scholar-nexus/oaktree-sapling', 'v0.3.0'),
    );
    expect(doc.getIn(['project', 'exports', 0, 'articles', 0, 'file'])).toBe('index.md');
    // oak sets `output` too, so the PDF's path does not depend on the config's filename
    expect(doc.getIn(['project', 'exports', 0, 'output'])).toBe(TYPST_OUTPUT);
    // The theme is set and the author's `youtube` option is kept as written: pass 2 does not
    // touch options, and loadConfig's resolved value ('…/x') is never written back.
    expect(doc.getIn(['site', 'template'])).toBe(themeZipUrl());
    expect(doc.getIn(['project', 'options', 'youtube'])).toBe('https://youtu.be/dQw4w9WgXcQ');

    expect(res.resolvedProject.id).toBe('fixture-2026-sample-paper');
  });

  it('honours assetOverrides (local typst template, omitted site template)', async () => {
    const paperRoot = tmpPaper();
    const { edge } = fakeEdge();
    await runBuild({
      paperRoot,
      engineRoot: '.engine',
      instanceRoot: '.instance',
      engineRepo: 'x/y',
      baseUrl: '',
      assetOverrides: { typstTemplate: '/local/typst', siteTemplate: null },
      edge,
    });
    const doc = parseDocument(readFileSync(join(paperRoot, DERIVED_CONFIG_FILE), 'utf8'));
    expect(doc.getIn(['project', 'exports', 0, 'template'])).toBe('/local/typst');
    expect(doc.getIn(['site', 'template'])).toBeUndefined(); // omitted → myst default theme
  });

  it("picks up the journal's typst_template and absolutizes it ([R76])", async () => {
    const paperRoot = tmpPaper();
    const instanceRoot = mkdtempSync(join(tmpdir(), 'oak-instance-'));
    writeFileSync(join(instanceRoot, 'journal.yml'), 'name: J\ntypst_template: ./typst-template\n');

    const { edge } = fakeEdge();
    const res = await runBuild({
      paperRoot,
      engineRoot: '.engine',
      instanceRoot,
      engineRepo: 'x/y',
      baseUrl: '',
      // oak's template is in the checkout, and the journal's wins over it
      assetOverrides: { engineTypstTemplate: '/engine/templates/typst' },
      edge,
    });

    const doc = parseDocument(readFileSync(join(paperRoot, DERIVED_CONFIG_FILE), 'utf8'));
    expect(doc.getIn(['project', 'exports', 0, 'template'])).toBe(
      join(instanceRoot, 'typst-template'),
    );
    // nothing was overridden, so no override warning
    expect(res.warnings.join(' ')).not.toMatch(/overrides the journal/);
  });

  it("never writes the author's myst.yml: it is unchanged after a build [R71]", async () => {
    const paperRoot = tmpPaper();
    const authorPath = join(paperRoot, 'myst.yml');
    const before = readFileSync(authorPath); // raw bytes, not a yaml round-trip

    const { edge } = fakeEdge();
    await runBuild({
      paperRoot,
      engineRoot: '.engine',
      instanceRoot: '.instance',
      engineRepo: 'x/y',
      baseUrl: '/p',
      edge,
    });

    expect(readFileSync(authorPath).equals(before)).toBe(true);
    // and oak's output is written beside it
    expect(existsSync(join(paperRoot, DERIVED_CONFIG_FILE))).toBe(true);
  });

  it('derived config is regenerated from the author config, not accumulated ([R71])', async () => {
    const paperRoot = tmpPaper();
    const run = () =>
      runBuild({
        paperRoot,
        engineRoot: '.engine',
        instanceRoot: '.instance',
        engineRepo: 'x/y',
        baseUrl: '/p',
        edge: fakeEdge().edge,
      });

    await run();
    const first = readFileSync(join(paperRoot, DERIVED_CONFIG_FILE), 'utf8');
    await run();
    const second = readFileSync(join(paperRoot, DERIVED_CONFIG_FILE), 'utf8');

    // Pass 1 always reads the author's myst.yml, so a second build gives the same result.
    expect(second).toBe(first);
    expect(first).toContain('GENERATED by `oak build`');
  });
});

describe('a missing version key is a sentence, not a stack', () => {
  it('names the file and the line to put back, as a UserError', async () => {
    // A missing version key is a UserError, printed as a sentence without a stack.
    const paperRoot = tmpPaper();
    const authorPath = join(paperRoot, 'myst.yml');
    writeFileSync(authorPath, readFileSync(authorPath, 'utf8').replace(/\n\s*version: .*/, ''));

    const err = await runBuild({
      paperRoot,
      engineRoot: '.engine',
      instanceRoot: '.instance',
      engineRepo: 'x/y',
      baseUrl: '',
      edge: fakeEdge().edge,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toContain(authorPath); // the file to edit
    expect(err.message).toContain('project.options.oaktree-sapling'); // where in it
    expect(err.message).toContain('oak upgrade'); // and what changes it for you
  });
});

describe('runStart: compose, then hand off to myst', () => {
  it('composes the same myst.oak.yml as a build and gives it to the server', async () => {
    const paperRoot = tmpPaper();
    const { edge, calls } = fakeEdge();

    await runStart({
      paperRoot,
      engineRoot: '.engine',
      instanceRoot: '.instance',
      engineRepo: 'x/y',
      baseUrl: '',
      startOpts: { port: 3210 },
      edge,
    });

    // Pass 1 loaded myst.oak.yml and myst was given it too, so the preview is what CI builds.
    expect(calls).toEqual([
      `load:${DERIVED_CONFIG_FILE}`,
      `start:${paperRoot}:{"port":3210}:${DERIVED_CONFIG_FILE}`,
    ]);
    // No build ran: the server does its own.
    expect(calls.some((c) => c.startsWith('build:'))).toBe(false);

    const doc = parseDocument(readFileSync(join(paperRoot, DERIVED_CONFIG_FILE), 'utf8'));
    expect(doc.getIn(['extends', 0])).toBe('.engine/paper-base.yml');
    expect(doc.getIn(['project', 'exports', 0, 'output'])).toBe(TYPST_OUTPUT);
  });

  it('does not stop a preview on Layer A findings, as a build does', async () => {
    // A new repo has the placeholder id, and that does not stop a preview. (index.md is
    // absent here, which does block `oak build`.)
    const paperRoot = mkdtempSync(join(tmpdir(), 'oak-start-'));
    copyFileSync(fixturePaper, join(paperRoot, 'myst.yml'));
    const { edge, calls } = fakeEdge();

    await runStart({
      paperRoot,
      engineRoot: '.engine',
      instanceRoot: '.instance',
      engineRepo: 'x/y',
      baseUrl: '',
      edge,
    });

    expect(calls.some((c) => c.startsWith('start:'))).toBe(true);
  });
});
