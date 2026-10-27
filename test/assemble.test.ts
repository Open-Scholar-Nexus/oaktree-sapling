/**
 * `oak assemble`: the journal website of a co-located repository, with each listed paper's build
 * mounted at `/<id>/`. The site build is faked, so neither npm nor myst runs.
 */
import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble, listedFolderIds, readBuilds, type AssembleDeps } from '../src/assemble.js';

/** A journal repo with `registry`, and a folder of paper builds named as the artifacts are. */
function setup(registry: string, built: string[]) {
  const siteRoot = mkdtempSync(join(tmpdir(), 'oak-assemble-'));
  mkdirSync(join(siteRoot, 'registry'));
  writeFileSync(join(siteRoot, 'registry', 'papers.yml'), registry);
  const builds = mkdtempSync(join(tmpdir(), 'oak-builds-'));
  for (const id of built) {
    const dir = join(builds, `paper-build-${id}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'index.html'), `paper ${id}`);
  }
  return { siteRoot, builds };
}

function fakeDeps(pages: string[] = []): AssembleDeps & { baseUrls: string[]; lines: string[] } {
  const baseUrls: string[] = [];
  const lines: string[] = [];
  return {
    baseUrls,
    lines,
    buildSite(siteRoot, baseUrl) {
      baseUrls.push(baseUrl);
      const html = join(siteRoot, '_build', 'html');
      mkdirSync(html, { recursive: true });
      writeFileSync(join(html, 'index.html'), 'journal');
      for (const p of pages) mkdirSync(join(html, p));
    },
    log: (l) => lines.push(l),
  };
}

const twoListed =
  '- id: a-2026-one\n  location: ./papers/a-2026-one\n' +
  '- id: b-2026-two\n  location: ./papers/b-2026-two/\n' +
  '- id: c-2026-ext\n  location: acme/external-paper\n';

describe('assemble', () => {
  it('builds the site and mounts each listed paper at /<id>/', () => {
    const { siteRoot, builds } = setup(twoListed, ['a-2026-one', 'b-2026-two']);
    const deps = fakeDeps();
    const out = assemble(readBuilds(builds), { siteRoot, baseUrl: '/journal' }, deps);
    expect(out.exitCode).toBe(0);
    expect(out.result.papers).toEqual(['a-2026-one', 'b-2026-two']);
    expect(deps.baseUrls).toEqual(['/journal']);
    const html = join(siteRoot, '_build', 'html');
    expect(readFileSync(join(html, 'a-2026-one', 'index.html'), 'utf8')).toBe('paper a-2026-one');
    expect(readFileSync(join(html, 'index.html'), 'utf8')).toBe('journal');
  });

  it('refuses before building when a listed paper has no build', () => {
    const { siteRoot, builds } = setup(twoListed, ['a-2026-one']);
    const deps = fakeDeps();
    const out = assemble(readBuilds(builds), { siteRoot, baseUrl: '' }, deps);
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('b-2026-two');
    expect(deps.baseUrls).toEqual([]);
  });

  it('leaves out a build the registry does not list (a draft)', () => {
    const { siteRoot, builds } = setup(twoListed, ['a-2026-one', 'b-2026-two', 'd-2026-draft']);
    const deps = fakeDeps();
    assemble(readBuilds(builds), { siteRoot, baseUrl: '' }, deps);
    expect(existsSync(join(siteRoot, '_build', 'html', 'd-2026-draft'))).toBe(false);
    expect(deps.lines.join('\n')).toContain('d-2026-draft is built but not listed');
  });

  it('refuses a paper id the site already serves', () => {
    const { siteRoot, builds } = setup(twoListed, ['a-2026-one', 'b-2026-two']);
    const out = assemble(readBuilds(builds), { siteRoot, baseUrl: '' }, fakeDeps(['a-2026-one']));
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('already serves /a-2026-one/');
  });

  it('copies no symlink and no Stage 1 file', () => {
    const { siteRoot, builds } = setup(twoListed, ['a-2026-one', 'b-2026-two']);
    const dir = join(builds, 'paper-build-a-2026-one');
    symlinkSync('/etc/passwd', join(dir, 'leak'));
    writeFileSync(join(dir, '.pr-number'), '7\n');
    assemble(readBuilds(builds), { siteRoot, baseUrl: '' }, fakeDeps());
    const mounted = join(siteRoot, '_build', 'html', 'a-2026-one');
    expect(existsSync(join(mounted, 'leak'))).toBe(false);
    expect(existsSync(join(mounted, '.pr-number'))).toBe(false);
  });
});

describe('readBuilds and listedFolderIds', () => {
  it('refuses a build folder not named paper-build-<id>', () => {
    const builds = mkdtempSync(join(tmpdir(), 'oak-builds-'));
    for (const bad of ['paper-build-..x', 'site', 'paper-build-']) {
      mkdirSync(join(builds, bad), { recursive: true });
      expect(() => readBuilds(builds), bad).toThrow(/is not a paper build/);
      rmSync(join(builds, bad), { recursive: true });
    }
  });

  it('reads only folder entries in this repository papers/ folder', () => {
    const { siteRoot } = setup(twoListed + '- id: x\n  location: ../elsewhere\n', []);
    expect(listedFolderIds(siteRoot)).toEqual(['a-2026-one', 'b-2026-two']);
  });
});
