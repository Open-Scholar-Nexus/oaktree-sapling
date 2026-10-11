/**
 * The template trees that bootstrap writes into one repo share no path. `templates/paper/`,
 * `templates/instance/` and `templates/site/` are separate trees, and two pairs land in the
 * same repo:
 *
 *   paper + instance   `oak bootstrap journal --co-located`
 *   site  + instance   `oak bootstrap journal`
 *
 * `site` and `paper` are not checked: they never land together, and both have a root `myst.yml`
 * and `.gitignore`. A file that belongs in both trees of a checked pair fails here, so someone
 * decides which wins, rather than the write order.
 */
import { describe, it, expect } from 'vitest';
import { stampedFiles, listFiles, STAMP_RENAME } from '../src/bootstrap.js';

const PAPER_ROOT = 'templates/paper';
const INSTANCE_ROOT = 'templates/instance';
const SITE_ROOT = 'templates/site';
const TYPST_ROOT = 'templates/typst';

const overlap = (a: string, b: string) => {
  const first = new Set(stampedFiles(a));
  return stampedFiles(b).filter((rel) => first.has(rel));
};

describe('template disjointness invariant', () => {
  it('--co-located: the paper and journal templates write different paths', () => {
    expect(overlap(PAPER_ROOT, INSTANCE_ROOT)).toEqual([]);
  });

  it('external: the website and journal templates write different paths', () => {
    expect(overlap(SITE_ROOT, INSTANCE_ROOT)).toEqual([]);
  });
});

/**
 * npm leaves `.gitignore` out of every package, so a template holding one would seed a repo
 * without it when oak comes from npm. The templates hold `gitignore`, and `stampRel` adds the
 * dot when writing. The names come from `STAMP_RENAME`, and every template is searched at every
 * depth, so a new name in the map, or a `.gitignore` further down, is caught too.
 */
describe('templates survive npm packaging', () => {
  const STRIPPED = new Set(Object.values(STAMP_RENAME));

  for (const root of [PAPER_ROOT, INSTANCE_ROOT, SITE_ROOT, TYPST_ROOT]) {
    it(`${root} ships no file npm would strip from the tarball`, () => {
      const offenders = listFiles(root).filter((rel) => STRIPPED.has(rel.split('/').pop()!));
      expect(offenders).toEqual([]);
    });
  }

  for (const root of [PAPER_ROOT, SITE_ROOT]) {
    it(`${root} still stamps a .gitignore`, () => {
      expect(stampedFiles(root)).toContain('.gitignore');
    });
  }
});
