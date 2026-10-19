/**
 * The journal website's `paper-cards` plugin [R80]. It is a plain `.mjs` that myst loads by URL,
 * so vitest imports it directly. Its decisions are exported as pure functions, testable without
 * myst or the network. Whether a card renders needs an HTML build, which needs the theme from
 * the network, so it is not tested here.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs consumed by myst at runtime; no types by design.
import {
  selectEntries,
  paperUrls,
  cardFrom,
  loadRegistry,
  fetchPaperConfig,
  thumbnailAvailable,
  renderCards,
  clearCache,
  parseLocation as galleryParseLocation,
  pagesUrl as galleryPagesUrl,
  REGISTRY_PATH,
} from '../plugins/gallery.mjs';
import { pagesUrl, parseLocation } from '../src/schema.js';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'j-2026-alpha',
  location: 'me/alpha-paper',
  ...over,
});

const config = (over: Record<string, unknown> = {}) => ({
  project: { title: 'An Alpha Paper', keywords: ['neuro', 'imaging'], ...over },
});

const withEdition = (edition: string) => ({
  project: { options: { 'oaktree-sapling': { edition } } },
});

/* -------------------------------------------------------------------------- */

describe('selectEntries', () => {
  const papers = [
    { entry: entry({ id: 'a' }), config: withEdition('ed-2026') },
    { entry: entry({ id: 'b' }), config: withEdition('ed-2025') },
    { entry: entry({ id: 'c' }), config: withEdition('ed-2026') },
  ];
  const ids = (list: Array<{ entry: { id: string } }>) => list.map((p) => p.entry.id);

  it('returns every paper when :edition: is omitted (the single page the template starts with)', () => {
    expect(ids(selectEntries(papers))).toEqual(['a', 'b', 'c']);
    expect(ids(selectEntries(papers, {}))).toEqual(['a', 'b', 'c']);
  });

  it("filters by the edition in each paper's own myst.yml", () => {
    expect(ids(selectEntries(papers, { edition: 'ed-2026' }))).toEqual(['a', 'c']);
  });

  it('ignores an edition left in the registry entry', () => {
    const stale = [
      { entry: entry({ id: 'a', edition: 'ed-2026' }), config: withEdition('ed-2025') },
    ];
    expect(ids(selectEntries(stale, { edition: 'ed-2026' }))).toEqual([]);
  });

  it("keeps the registry's order, which the editor sets", () => {
    expect(ids(selectEntries([...papers].reverse()))).toEqual(['c', 'b', 'a']);
  });
});

describe('location rule parity', () => {
  // gallery.mjs cannot import TypeScript, so it keeps its own copy of parseLocation.
  const cases: Array<[unknown, unknown]> = [
    ['me/alpha-paper', { repo: 'me/alpha-paper' }],
    ['Open-Scholar-Nexus/conformance.paper_2', { repo: 'Open-Scholar-Nexus/conformance.paper_2' }],
    ['./papers/alpha', { path: './papers/alpha' }],
    ['../alpha', { path: '../alpha' }],
    ['https://github.com/me/alpha-paper', null],
    ['gitlab.com/me/alpha', null],
    ['me/alpha/sub', null],
    ['me', null],
    ['papers/alpha/', null],
    ['me/..', null],
    ['-me/alpha', null],
    ['me/${{ x }}', null],
    ['', null],
    [{ repo: 'me/alpha-paper', path: '.' }, null],
    [undefined, null],
  ];
  it.each(cases)('%j reads the same in src/schema.ts and gallery.mjs', (value, expected) => {
    expect(parseLocation(value)).toEqual(expected);
    expect(galleryParseLocation(value)).toEqual(expected);
  });
});

describe('Pages URL parity', () => {
  // gallery.mjs cannot import TypeScript, so it keeps its own copy of pagesUrl.
  it.each(['me/alpha-paper', 'Me/Alpha-Paper', 'me/me.github.io', 'Me/ME.github.io'])(
    '%s gives the same URL in src/schema.ts and gallery.mjs',
    (repo) => {
      expect(galleryPagesUrl(repo)).toBe(pagesUrl(repo));
    },
  );

  it('links a paper in the <owner>.github.io repo to the root site', () => {
    expect(paperUrls(entry({ location: 'me/me.github.io' })).siteUrl).toBe('https://me.github.io/');
  });
});

describe('paperUrls', () => {
  it('derives the Pages URL from the repository when site_url is absent', () => {
    const u = paperUrls(entry());
    expect(u.siteUrl).toBe('https://me.github.io/alpha-paper/');
    expect(u.configUrl).toBe('https://raw.githubusercontent.com/me/alpha-paper/HEAD/myst.yml');
    expect(u.thumbUrl).toBe(
      'https://raw.githubusercontent.com/me/alpha-paper/HEAD/thumbnails/thumbnail.png',
    );
  });

  it('honours site_url (a custom domain, or hosting elsewhere) without changing the raw URLs', () => {
    const u = paperUrls(entry({ site_url: 'https://journal.example.org/alpha' }));
    expect(u.siteUrl).toBe('https://journal.example.org/alpha');
    expect(u.configUrl).toBe('https://raw.githubusercontent.com/me/alpha-paper/HEAD/myst.yml');
  });

  it('refuses a relative path, naming the entry', () => {
    expect(() => paperUrls(entry({ location: './papers/alpha' }))).toThrow(
      '"j-2026-alpha": relative paths are not supported (./papers/alpha)',
    );
  });

  it('lowercases the owner in the Pages URL, as GitHub serves it', () => {
    expect(paperUrls(entry({ location: 'Me/Alpha-Paper' })).siteUrl).toBe(
      'https://me.github.io/Alpha-Paper/',
    );
  });

  it('uses HEAD, not main, so another default branch name still works', () => {
    expect(paperUrls(entry()).configUrl).toContain('/HEAD/');
    expect(paperUrls(entry()).configUrl).not.toContain('/main/');
  });

  it('throws naming the entry and the registry for a location it cannot read', () => {
    expect(() => paperUrls(entry({ location: undefined }))).toThrow(/"j-2026-alpha"/);
    expect(() => paperUrls(entry({ location: 'https://gitlab.com/me/alpha' }))).toThrow(
      REGISTRY_PATH,
    );
  });

  it('names the string to write for the { repo, path } form', () => {
    expect(() => paperUrls(entry({ location: { repo: 'me/alpha-paper', path: '.' } }))).toThrow(
      'write "location: me/alpha-paper"',
    );
  });
});

describe('cardFrom', () => {
  const kinds = (card: { children: Array<{ type: string }> }) => card.children.map((c) => c.type);

  it('renders title + thumbnail + keywords, linked to the paper site', () => {
    const card = cardFrom(entry(), config());
    expect(card.type).toBe('card');
    expect(card.url).toBe('https://me.github.io/alpha-paper/');
    expect(kinds(card)).toEqual(['header', 'image', 'paragraph']);
    expect(card.children[0].children[0].value).toBe('An Alpha Paper');
    expect(card.children[1].url).toContain('thumbnails/thumbnail.png');
    expect(card.children[2].children[0].value).toBe('neuro | imaging');
  });

  it("renders the paper's own DOI as text, since a DOI link becomes a citation", () => {
    const card = cardFrom(
      entry({ doi: '10.5281/zenodo.999' }),
      config({ doi: '10.5281/zenodo.123' }),
    );
    expect(kinds(card)).toContain('footer');
    const node = card.children.at(-1).children[0].children[0];
    expect(node.type).toBe('text');
    expect(node.value).toBe('DOI: 10.5281/zenodo.123');
    // myst turns a link to a DOI into a citation, with a label and a bibliography on the card
    // and a rate-limited doi.org request per paper, so the DOI is plain text.
    expect(JSON.stringify(card)).not.toContain('doi.org');
  });

  it('omits keywords and DOI when there are none', () => {
    const card = cardFrom(entry(), config({ keywords: undefined }));
    expect(kinds(card)).toEqual(['header', 'image']);
  });

  it('falls back to the id when the fetched config has no title', () => {
    expect(cardFrom(entry(), { project: {} }).children[0].children[0].value).toBe('j-2026-alpha');
  });

  it('carries the remote thumbnail URL; myst downloads it (stage: document)', () => {
    expect(cardFrom(entry(), config()).children[1].url).toMatch(/^https:\/\//);
  });

  it('leaves the image out when the thumbnail is unavailable', () => {
    const card = cardFrom(entry(), config(), { thumbnail: false });
    expect(kinds(card)).toEqual(['header', 'paragraph']);
  });
});

describe('thumbnailAvailable: a missing thumbnail drops the image, not the site build', () => {
  const answer =
    (ok: boolean, type: string | null) => async (_url: string, init?: { method?: string }) => {
      expect(init?.method).toBe('HEAD');
      return { ok, headers: { get: () => type } };
    };

  it('is true for an image', async () => {
    expect(await thumbnailAvailable(entry(), answer(true, 'image/png'))).toBe(true);
  });

  it("is false for raw.githubusercontent.com's 404, a text body", async () => {
    expect(await thumbnailAvailable(entry(), answer(false, 'text/plain; charset=utf-8'))).toBe(
      false,
    );
  });

  it('is false for a 200 that is not an image', async () => {
    expect(await thumbnailAvailable(entry(), answer(true, 'text/html'))).toBe(false);
  });

  it('is false on a network error', async () => {
    const boom = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    expect(await thumbnailAvailable(entry(), boom)).toBe(false);
  });
});

describe('fetchPaperConfig: a failure stops the build, since a broken registry must be fixed', () => {
  it('throws with the id and the URL, which the registry fix needs', async () => {
    const notFound = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(fetchPaperConfig(entry(), notFound)).rejects.toThrow(
      /j-2026-alpha.*raw\.githubusercontent\.com\/me\/alpha-paper\/HEAD\/myst\.yml.*404/s,
    );
    await expect(fetchPaperConfig(entry(), notFound)).rejects.toThrow(REGISTRY_PATH);
  });

  it('throws on a network error too, not just a bad status', async () => {
    const boom = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    await expect(fetchPaperConfig(entry(), boom)).rejects.toThrow(/ENOTFOUND/);
  });

  it('parses the fetched YAML on success', async () => {
    const ok = async () => ({ ok: true, text: async () => 'project:\n  title: Fetched\n' });
    expect(await fetchPaperConfig(entry(), ok)).toEqual({ project: { title: 'Fetched' } });
  });
});

describe('renderCards: one fetch per paper per build', () => {
  const papers: Record<string, string> = {
    a: 'project:\n  title: A\n  options:\n    oaktree-sapling:\n      edition: ed-2026\n',
    b: 'project:\n  title: B\n  options:\n    oaktree-sapling:\n      edition: ed-2025\n',
  };
  const counting = () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'HEAD') return { ok: true, headers: { get: () => 'image/png' } };
      const name = url.match(/me\/(\w+)\//)![1]!;
      return { ok: true, text: async () => papers[name]! };
    };
    return { calls, fetchImpl };
  };
  const registry = [entry({ id: 'a', location: 'me/a' }), entry({ id: 'b', location: 'me/b' })];

  it('filters on the fetched edition, and a second block reuses the fetches', async () => {
    clearCache();
    const { calls, fetchImpl } = counting();
    const first = await renderCards(registry, { edition: 'ed-2026' }, fetchImpl);
    const second = await renderCards(registry, { edition: 'ed-2025' }, fetchImpl);
    const all = await renderCards(registry, {}, fetchImpl);
    expect(first.children.map((c: any) => c.children[0].children[0].value)).toEqual(['A']);
    expect(second.children.map((c: any) => c.children[0].children[0].value)).toEqual(['B']);
    expect(all.children).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('GET'))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('HEAD'))).toHaveLength(2);
  });

  it('leaves out a paper with a Zenodo sandbox DOI, with a warning, and lists one with no DOI or a real one', async () => {
    clearCache();
    const { calls, fetchImpl } = counting();
    papers.s = 'project:\n  title: S\n  doi: 10.5072/zenodo.612991\n';
    papers.r = 'project:\n  title: R\n  doi: 10.5281/zenodo.123\n';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await renderCards(
      [...registry, entry({ id: 's', location: 'me/s' }), entry({ id: 'r', location: 'me/r' })],
      {},
      fetchImpl,
    );
    expect(out.children.map((c: any) => c.children[0].children[0].value)).toEqual(['A', 'B', 'R']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"s" has a Zenodo sandbox DOI'));
    expect(calls).not.toContain(
      'HEAD https://raw.githubusercontent.com/me/s/HEAD/thumbnails/thumbnail.png',
    );
    warn.mockRestore();
    delete papers.s;
    delete papers.r;
  });

  it('says "No papers found." when no paper is in the edition', async () => {
    clearCache();
    const { fetchImpl } = counting();
    const out = await renderCards(registry, { edition: 'ed-1999' }, fetchImpl);
    expect(out).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'No papers found.' }],
    });
  });
});

describe('loadRegistry', () => {
  it('reads a list of entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-reg-'));
    const file = join(dir, 'papers.yml');
    writeFileSync(file, '- id: x\n  location: me/x\n');
    expect(loadRegistry(file)).toEqual([{ id: 'x', location: 'me/x' }]);
  });

  it('an empty registry is a valid empty list (the directive renders "No papers found.")', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-reg-'));
    const file = join(dir, 'papers.yml');
    writeFileSync(file, '[]\n');
    expect(loadRegistry(file)).toEqual([]);
  });

  it('a missing registry is an error, not an empty gallery', () => {
    expect(() => loadRegistry('/nonexistent/registry/papers.yml')).toThrow(/cannot read/);
  });

  it('a non-list registry is fatal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-reg-'));
    const file = join(dir, 'papers.yml');
    writeFileSync(file, 'papers: []\n');
    expect(() => loadRegistry(file)).toThrow(/must be a LIST/);
  });
});

describe('the plugin name is what the site workflow checks', () => {
  it('is exactly what the site workflow greps for', async () => {
    // The site workflow looks for `Paper Gallery.*loaded` in the build log, since a plugin that
    // fails to load does not fail `myst build --strict` [R80]. The name must match.
    const plugin = (await import('../plugins/gallery.mjs')).default as { name: string };
    expect(plugin.name).toBe('Paper Gallery');
  });
});
