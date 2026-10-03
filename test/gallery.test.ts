/**
 * The journal website's `paper-cards` plugin [R80]. It is a plain `.mjs` that myst loads by URL,
 * so vitest imports it directly. Its decisions are exported as pure functions, testable without
 * myst or the network. Whether a card renders needs an HTML build, which needs the theme from
 * the network [R60], so it is not tested here.
 */
import { describe, it, expect } from 'vitest';
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
  REGISTRY_PATH,
} from '../plugins/gallery.mjs';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'j-2026-alpha',
  slug: 'alpha',
  location: { repo: 'me/alpha-paper', path: '.' },
  edition: 'ed-2026',
  ...over,
});

const config = (over: Record<string, unknown> = {}) => ({
  project: { title: 'An Alpha Paper', keywords: ['neuro', 'imaging'], ...over },
});

/* -------------------------------------------------------------------------- */

describe('selectEntries', () => {
  const registry = [
    entry({ slug: 'a', edition: 'ed-2026' }),
    entry({ slug: 'b', edition: 'ed-2025' }),
    entry({ slug: 'c', edition: 'ed-2026' }),
  ];

  it('returns every paper when :edition: is omitted (the single page the template starts with)', () => {
    expect(selectEntries(registry).map((e: { slug: string }) => e.slug)).toEqual(['a', 'b', 'c']);
    expect(selectEntries(registry, {}).map((e: { slug: string }) => e.slug)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('filters by edition when given', () => {
    expect(
      selectEntries(registry, { edition: 'ed-2026' }).map((e: { slug: string }) => e.slug),
    ).toEqual(['a', 'c']);
  });

  it("keeps the registry's order, which the editor sets", () => {
    const reversed = [...registry].reverse();
    expect(selectEntries(reversed).map((e: { slug: string }) => e.slug)).toEqual(['c', 'b', 'a']);
  });
});

describe('paperUrls', () => {
  it('derives the Pages URL from location.repo when site_url is absent', () => {
    const u = paperUrls(entry());
    expect(u.siteUrl).toBe('https://me.github.io/alpha-paper');
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

  it('respects location.path: what keeps the n>1 tier reachable', () => {
    const u = paperUrls(entry({ location: { repo: 'me/journal', path: 'papers/alpha' } }));
    expect(u.configUrl).toBe(
      'https://raw.githubusercontent.com/me/journal/HEAD/papers/alpha/myst.yml',
    );
    expect(u.thumbUrl).toBe(
      'https://raw.githubusercontent.com/me/journal/HEAD/papers/alpha/thumbnails/thumbnail.png',
    );
  });

  it('uses HEAD, not main, so another default branch name still works', () => {
    expect(paperUrls(entry()).configUrl).toContain('/HEAD/');
    expect(paperUrls(entry()).configUrl).not.toContain('/main/');
  });

  it('throws naming the entry when location.repo is missing or malformed', () => {
    expect(() => paperUrls(entry({ location: { path: '.' } }))).toThrow(/alpha/);
    expect(() => paperUrls(entry({ location: { repo: 'nope' } }))).toThrow(/location\.repo/);
  });
});

describe('cardFrom', () => {
  const kinds = (card: { children: Array<{ type: string }> }) => card.children.map((c) => c.type);

  it('renders title + thumbnail + keywords, linked to the paper site', () => {
    const card = cardFrom(entry(), config());
    expect(card.type).toBe('card');
    expect(card.url).toBe('https://me.github.io/alpha-paper');
    expect(kinds(card)).toEqual(['header', 'image', 'paragraph']);
    expect(card.children[0].children[0].value).toBe('An Alpha Paper');
    expect(card.children[1].url).toContain('thumbnails/thumbnail.png');
    expect(card.children[2].children[0].value).toBe('neuro | imaging');
  });

  it('renders the DOI as text, since a DOI link becomes a citation', () => {
    const card = cardFrom(entry({ doi: '10.5281/zenodo.123' }), config());
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

  it('falls back to the slug when the fetched config has no title', () => {
    expect(cardFrom(entry(), { project: {} }).children[0].children[0].value).toBe('alpha');
  });

  it('does not fetch the thumbnail; myst downloads the URL (stage: document)', () => {
    // The card has a remote image URL; transformImagesToDisk downloads it later, which is also
    // what makes a broken thumbnail an error under --strict.
    expect(cardFrom(entry(), config()).children[1].url).toMatch(/^https:\/\//);
  });
});

describe('fetchPaperConfig: a failure stops the build, since a broken registry must be fixed', () => {
  it('throws with the slug and the URL, which the registry fix needs', async () => {
    const notFound = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(fetchPaperConfig(entry(), notFound)).rejects.toThrow(
      /alpha.*raw\.githubusercontent\.com\/me\/alpha-paper\/HEAD\/myst\.yml.*404/s,
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

describe('loadRegistry', () => {
  it('reads a list of entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-reg-'));
    const file = join(dir, 'papers.yml');
    writeFileSync(file, '- id: x\n  slug: x\n  edition: e\n  location:\n    repo: me/x\n');
    expect(loadRegistry(file)).toEqual([
      { id: 'x', slug: 'x', edition: 'e', location: { repo: 'me/x' } },
    ]);
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
