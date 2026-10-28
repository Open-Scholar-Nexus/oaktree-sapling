import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  OaktreeSaplingOptions,
  repoFromGithubUrl,
  pagesUrl,
  readEngineOptions,
  JournalConfig,
  Registry,
  Pins,
  checkIdShape,
  checkIdUniqueness,
  checkOwnEntryId,
  readRegistry,
  RegistryEntry,
  ENGINE_ID_SENTINEL,
  toJsonSchemas,
  parseZenodoDoi,
} from '../src/schema.js';

const read = (rel: string) =>
  parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

describe('OaktreeSaplingOptions', () => {
  it('parses a valid coordinate', () => {
    const opt = OaktreeSaplingOptions.parse({ version: 'v0.3.0', edition: 'e' });
    expect(opt).toEqual({ version: 'v0.3.0', edition: 'e' });
  });

  it('rejects a missing version', () => {
    expect(() => OaktreeSaplingOptions.parse({ edition: 'e' })).toThrow();
  });

  it('tolerates a future engine option key (additive-only)', () => {
    expect(() =>
      OaktreeSaplingOptions.parse({ version: 'v1.0.0', edition: 'e', future: true }),
    ).not.toThrow();
  });

  it('takes the journal stamp oak writes, and nothing shaped otherwise', () => {
    const parse = (journal: unknown) =>
      OaktreeSaplingOptions.safeParse({ version: 'v1.0.0', edition: 'e', journal }).success;
    expect(parse({ repo: 'o/j', commit: 'a'.repeat(40) })).toBe(true);
    expect(parse({ repo: null, commit: null })).toBe(true);
    expect(parse({ repo: '.' })).toBe(true);
    expect(parse({ repo: 'o/j', commit: 'HEAD' })).toBe(false);
    expect(parse({ repo: 'o/j', commit: 'abc123' })).toBe(false);
    expect(parse({ repo: 'o/j', commit: '--upload-pack=x' })).toBe(false);
    expect(parse({ repo: '-o/j', commit: 'a'.repeat(40) })).toBe(false);
    expect(parse({ repo: '.', commit: 'a'.repeat(40) })).toBe(false);
    expect(parse({ repo: 'o/j' })).toBe(false);
    expect(parse('o/j@' + 'a'.repeat(40))).toBe(false);
  });
});

describe('the edition id cannot carry a path ([R141])', () => {
  const opts = (edition: string) => () =>
    OaktreeSaplingOptions.parse({ version: 'v1.0.0', edition });

  it('refuses a path, which would point extends outside the journal repo', () => {
    for (const bad of ['../../../etc/shadow', './x', 'a/b', '..', '-lead']) {
      expect(opts(bad), bad).toThrow();
    }
  });

  it('accepts the ids a journal actually uses', () => {
    for (const good of ['2026', 'ed-2026', 'spring_2026', 'v1.2']) {
      expect(opts(good), good).not.toThrow();
    }
  });
});

describe('readEngineOptions (other options are kept)', () => {
  it('extracts the engine key without tripping on a sibling youtube option', () => {
    const projectOptions = {
      youtube: 'https://youtu.be/x',
      'oaktree-sapling': { version: 'v0.3.0', edition: 'fixture-edition' },
    };
    expect(readEngineOptions(projectOptions)).toEqual({
      version: 'v0.3.0',
      edition: 'fixture-edition',
    });
  });

  it('throws a clear error when the engine key is absent', () => {
    expect(() => readEngineOptions({ youtube: 'x' })).toThrow(/missing/);
  });
});

describe('fixtures parse against the schemas', () => {
  it('fixture journal.yml is a valid JournalConfig', () => {
    const j = JournalConfig.parse(read('./fixture-instance/journal.yml'));
    expect(j.name).toBe('Fixture Journal');
    expect(j.preview.provider).toBe('artifact');
    expect(j.zenodo.community).toBe('fixture-community');
  });

  it('fixture registry is a valid Registry with distinct id and location', () => {
    const r = Registry.parse(read('./fixture-instance/registry/papers.yml'));
    expect(r).toHaveLength(1);
    const e = r[0]!;
    expect(e.id).toBe('fixture-2026-sample-paper');
    expect(e.location).toBe('open-scholar-nexus/fixture-sample-paper');
  });

  it('fixture paper options round-trip through readEngineOptions', () => {
    const paper = read('./fixture-paper/myst.yml');
    expect(readEngineOptions(paper.project.options)).toEqual({
      version: 'v0.3.0',
      edition: 'fixture-edition',
    });
  });
});

describe('JournalConfig additive-only ([R197])', () => {
  it('ignores an unknown top-level key instead of rejecting', () => {
    const j = JournalConfig.parse({ name: 'X', future_field: 42 });
    expect(j.name).toBe('X');
  });
});

describe('checkIdShape (check A: catches the live geetha bug [R12])', () => {
  const policy = {
    id_sentinel: 'fixture-template-placeholder',
    id_pattern: '^fixture-\\d{4}-[a-z0-9-]+$',
  };

  it('rejects the template sentinel id', () => {
    const r = checkIdShape('fixture-template-placeholder', policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe('error');
  });

  it('rejects an id that violates the pattern', () => {
    const r = checkIdShape('NotMatching', policy);
    expect(r.ok).toBe(false);
  });

  it('accepts a well-formed unique id', () => {
    expect(checkIdShape('fixture-2026-sample-paper', policy).ok).toBe(true);
  });

  it("rejects oak's own placeholder with an empty policy [R119]", () => {
    // A journal without id_sentinel and id_pattern still has oak's placeholder rejected.
    expect(checkIdShape(ENGINE_ID_SENTINEL, {}).ok).toBe(false);
    expect(checkIdShape(ENGINE_ID_SENTINEL, policy).ok).toBe(false);
    expect(checkIdShape('fixture-2026-sample-paper', {}).ok).toBe(true);
  });

  it('is the id the paper template actually ships', () => {
    const template = read('../templates/paper/myst.yml');
    expect(template.project.id).toBe(ENGINE_ID_SENTINEL);
  });
});

describe('checkIdUniqueness (check B, needs the registry)', () => {
  const registry = Registry.parse(read('./fixture-instance/registry/papers.yml'));

  it('flags a duplicate id owned by another paper', () => {
    const r = checkIdUniqueness('fixture-2026-sample-paper', registry, {
      repo: 'someone/a-different-paper',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe('error');
  });

  it('does not flag a paper against its own registry entry', () => {
    const r = checkIdUniqueness('fixture-2026-sample-paper', registry, {
      repo: 'open-scholar-nexus/fixture-sample-paper',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts an entry with no slug, edition or doi, and ignores them when set', () => {
    const r = Registry.parse([
      { id: 'a', location: 'o/a' },
      { id: 'b', slug: 'b', edition: 'e', doi: '10.5281/zenodo.1', location: 'o/b' },
    ]);
    expect(r).toHaveLength(2);
    expect(checkIdUniqueness('b', r, { repo: 'o/a' }).ok).toBe(false);
  });

  it('matches its own entry whatever the case of the repository name', () => {
    const r = checkIdUniqueness('fixture-2026-sample-paper', registry, {
      repo: 'Open-Scholar-Nexus/Fixture-Sample-Paper',
    });
    expect(r.ok).toBe(true);
  });

  it('counts a folder entry in the journal repository as another paper', () => {
    const r = Registry.parse([{ id: 'a', location: './papers/a' }]);
    const out = checkIdUniqueness('a', r, { repo: 'o/journal' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('./papers/a');
  });

  it('soft-warns when the registry is unavailable (bare local validate)', () => {
    const r = checkIdUniqueness('anything', null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe('warn');
  });

  it('downgrades a clash to a warning when self is not identifiable (no repo context)', () => {
    // A local run without GITHUB_REPOSITORY cannot tell the paper's own entry from a
    // duplicate, so it only warns.
    const r = checkIdUniqueness('fixture-2026-sample-paper', registry, undefined, {
      selfIdentifiable: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe('warn');
  });
});

describe('checkOwnEntryId (check C: the registry holds the id the paper has)', () => {
  it('passes when every own entry has the paper id, or there is none', () => {
    expect(checkOwnEntryId('a', [{ id: 'a', location: 'o/a' }]).ok).toBe(true);
    expect(checkOwnEntryId('a', []).ok).toBe(true);
  });

  it('fails naming both ids when the registry has an old one', () => {
    const r = checkOwnEntryId('new-id', [{ id: 'old-id', location: 'o/a' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.severity).toBe('error');
      expect(r.message).toContain('"old-id"');
      expect(r.message).toContain('"new-id"');
    }
  });
});

describe('registry location: one string', () => {
  it('rejects a URL, a nested path, and the { repo, path } form', () => {
    for (const location of ['https://github.com/o/a', 'papers/a/b', { repo: 'o/a', path: '.' }]) {
      expect(RegistryEntry.safeParse({ id: 'a', location }).success).toBe(false);
    }
  });

  it('readRegistry keeps the valid entries and skips the rest, naming each', () => {
    const read = readRegistry([
      { id: 'good', location: 'o/good' },
      { id: 'old', location: { repo: 'o/old', path: '.' } },
      { id: 'sub', location: { repo: 'o/journal', path: 'papers/sub' } },
      { id: 'url', location: 'https://gitlab.com/o/url' },
      { location: 'o/no-id' },
    ])!;
    expect(read.entries.map((e) => e.id)).toEqual(['good']);
    expect(read.skipped).toEqual([
      { label: 'old', reason: 'location', hint: 'o/old' },
      { label: 'sub', reason: 'location' },
      { label: 'url', reason: 'location' },
      { label: '#5', reason: 'other' },
    ]);
  });

  it('readRegistry reads an empty file as no entries, and a non-list as null', () => {
    expect(readRegistry(null)).toEqual({ entries: [], skipped: [] });
    expect(readRegistry({ papers: [] })).toBeNull();
  });

  it('exports a JSON Schema for the registry', () => {
    expect(JSON.stringify(toJsonSchemas().registry)).toContain('location');
  });
});

describe('Pins', () => {
  it('leaves instance_repo out when omitted: the journal is unknown, not this repo', () => {
    const p = Pins.parse({ engine_repo: 'open-scholar-nexus/oaktree-sapling' });
    expect(p.instance_repo).toBeUndefined();
  });
});

describe('JSON Schema export', () => {
  it('emits schemas for author-editor autocomplete', () => {
    const s = toJsonSchemas();
    expect(s.journal).toHaveProperty('type', 'object');
    expect(s.oaktreeSaplingOptions).toHaveProperty('properties');
  });
});

describe('repoFromGithubUrl', () => {
  it('reads owner/name from every remote and page shape', () => {
    for (const url of [
      'https://github.com/acme/paper',
      'https://github.com/acme/paper.git',
      'https://github.com/acme/paper/',
      'git@github.com:acme/paper.git',
      'ssh://git@github.com/acme/paper.git',
    ])
      expect(repoFromGithubUrl(url), url).toBe('acme/paper');
  });

  it('is null for another host, a mismatched separator, a deeper page or a path', () => {
    for (const url of [
      'https://gitlab.com/acme/paper',
      'https://evilgithub.com/acme/paper',
      'https://user:token@github.com/acme/paper',
      'https://github.com/acme/paper/tree/main',
      'https://github.com/../..',
      'acme/paper',
      'https://github.com:acme/paper',
      'git@github.com/acme/paper',
      'ssh://git@github.com:acme/paper',
      'https://github.com/acme/paper///',
    ])
      expect(repoFromGithubUrl(url), url).toBeNull();
  });
});

describe('parseZenodoDoi', () => {
  it('reads a DOI Zenodo or its sandbox minted', () => {
    expect(parseZenodoDoi('10.5281/zenodo.42')).toEqual({ sandbox: false, recordId: '42' });
    expect(parseZenodoDoi('10.5072/zenodo.7')).toEqual({ sandbox: true, recordId: '7' });
  });

  it('is null for any other spelling, so no verb guesses an environment for it', () => {
    for (const doi of [
      'https://doi.org/10.5072/zenodo.7',
      '10.5072/other',
      '10.5281/zenodo.42 ',
      '10.5281/zenodo.abc',
      '10.1234/zenodo.1',
    ])
      expect(parseZenodoDoi(doi)).toBeNull();
  });
});

describe('pagesUrl', () => {
  it('is a project site under the repo name, with a lowercase owner', () => {
    expect(pagesUrl('Me/Config')).toBe('https://me.github.io/Config/');
  });

  it('is the root for a repo named <owner>.github.io, in any case', () => {
    expect(pagesUrl('Me/me.github.io')).toBe('https://me.github.io/');
    expect(pagesUrl('Me/ME.GitHub.io')).toBe('https://me.github.io/');
  });
});
