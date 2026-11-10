/**
 * The journal site's `paper-cards` directive: a card per paper in `registry/papers.yml`, with
 * title, keywords, edition and DOI from the paper's own `myst.yml`.
 *
 * myst loads this file by URL and imports it from the site repo, so any import must be in the
 * site scaffold's `package.json` (today only `js-yaml`).
 *
 * A paper whose `myst.yml` won't fetch fails the build; Pages keeps the last deploy. The site
 * workflow checks the plugin's `name` in the build log, so keep it. A missing thumbnail only
 * drops the picture; the transform runs at `stage: 'document'` so myst downloads it.
 */
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

/** The paper list, relative to the site build root. The site is the journal repo, so the path
 *  is fixed [S8]. */
export const REGISTRY_PATH = 'registry/papers.yml';

/** Reads the paper list. A missing or malformed list fails the build, so the site never
 *  deploys an empty gallery. */
export function loadRegistry(file = REGISTRY_PATH) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(
      `paper-cards: cannot read the paper registry at "${file}" (${err.message}). ` +
        `The gallery is built from this repo's registry, run the build from the repo root.`,
    );
  }
  const entries = yaml.load(raw) ?? [];
  if (!Array.isArray(entries)) {
    throw new Error(`paper-cards: "${file}" must be a list of registry entries (design §9).`);
  }
  return entries;
}

const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

/** A registry `location`: `{ repo }` for `owner/name`, `{ path }` for a `./` or `../` folder in
 *  the journal repo, else null. Copies `parseLocation` in `src/schema.ts`; the test
 *  `location rule parity` in `test/gallery.test.ts` checks they agree. */
export function parseLocation(value) {
  if (typeof value !== 'string') return null;
  if (/^\.\.?\//.test(value)) return { path: value };
  if (GITHUB_REPO.test(value)) return { repo: value };
  return null;
}

/** The GitHub Pages URL of `owner/name`; the site root for a repo named `<owner>.github.io`.
 *  Copies `pagesUrl` in `src/schema.ts`; the test `Pages URL parity` in `test/gallery.test.ts`
 *  checks they agree. */
export function pagesUrl(repo) {
  const [owner, name] = repo.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}

/** A paper's edition, from its fetched `myst.yml`, or undefined. */
export function editionOf(config) {
  return config?.project?.options?.['oaktree-sapling']?.edition;
}

/**
 * The papers a `:::{paper-cards}` block shows, in the order of `registry/papers.yml`, so editors
 * order the gallery by where they insert an entry. Without `edition`, every registered paper
 * is shown; a journal with several editions adds a page per edition and filters it [S6].
 * `papers` pairs each entry with its fetched `myst.yml`, which holds the edition.
 */
export function selectEntries(papers, opts = {}) {
  const { edition } = opts;
  return edition ? papers.filter(({ config }) => editionOf(config) === edition) : [...papers];
}

/**
 * A card's site, config and thumbnail URLs. `site_url` takes precedence over the Pages URL. Raw
 * files are read at `HEAD`, so any default branch works; `paper-base.yml` fixes the thumbnail path.
 * Throws for a relative path, which the website does not list yet.
 */
export function paperUrls(entry) {
  const id = entry?.id ?? '?';
  const location = parseLocation(entry?.location);
  if (!location) {
    const old = entry?.location?.repo;
    const fix =
      typeof old === 'string' && parseLocation(old)?.repo
        ? `write "location: ${old}"`
        : 'write "owner/name" for a GitHub repository';
    throw new Error(
      `paper-cards: registry entry "${id}" has a location oak cannot read; ${fix} in ${REGISTRY_PATH}.`,
    );
  }
  if (!location.repo) {
    throw new Error(
      `paper-cards: registry entry "${id}": relative paths are not supported ` +
        `(${location.path}); write "owner/name" in ${REGISTRY_PATH}.`,
    );
  }
  const { repo } = location;
  const raw = `https://raw.githubusercontent.com/${repo}/HEAD/`;
  return {
    siteUrl: entry.site_url ?? pagesUrl(repo),
    configUrl: `${raw}myst.yml`,
    thumbUrl: `${raw}thumbnails/thumbnail.png`,
  };
}

/** The Zenodo sandbox's DOI prefix. A sandbox DOI never resolves, so its paper is left out. */
export const SANDBOX_DOI_PREFIX = '10.5072/';

/** The paper's sandbox DOI, from its fetched `myst.yml`, or undefined. */
export function sandboxDoi(config) {
  const doi = config?.project?.doi;
  return typeof doi === 'string' && doi.startsWith(SANDBOX_DOI_PREFIX) ? doi : undefined;
}

/**
 * One card node from a registry entry and the paper's `myst.yml`. `opts.thumbnail: false`
 * leaves the image out.
 */
export function cardFrom(entry, config, opts = {}) {
  const { siteUrl, thumbUrl } = paperUrls(entry);
  const project = config?.project ?? {};
  const title = project.title || entry.id;
  const keywords = project.keywords ?? [];
  const doi = typeof project.doi === 'string' ? project.doi : undefined;

  const children = [{ type: 'header', children: [{ type: 'text', value: title }] }];
  if (opts.thumbnail !== false) {
    children.push({ type: 'image', url: thumbUrl, alt: title, width: '100%' });
  }
  if (keywords.length > 0) {
    children.push({ type: 'paragraph', children: [{ type: 'text', value: keywords.join(' | ') }] });
  }
  // Text, not a link: myst turns a DOI link into a citation and fetches it from doi.org,
  // which fails the build under `--strict` when doi.org is unreachable.
  if (doi) {
    children.push({
      type: 'footer',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: `DOI: ${doi}` }] }],
    });
  }
  return { type: 'card', url: siteUrl, children };
}

/** Fetch one paper's `myst.yml`. Errors name the entry's id and the URL. */
export async function fetchPaperConfig(entry, fetchImpl = fetch) {
  const { configUrl } = paperUrls(entry);
  let response;
  try {
    response = await fetchImpl(configUrl);
  } catch (err) {
    throw new Error(
      `paper-cards: failed to fetch the config for "${entry.id}" from ${configUrl} ` +
        `(${err.message}). Fix or remove the entry in ${REGISTRY_PATH}.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `paper-cards: failed to fetch the config for "${entry.id}" from ${configUrl} ` +
        `(${response.status} ${response.statusText}). Fix or remove the entry in ${REGISTRY_PATH}.`,
    );
  }
  return yaml.load(await response.text());
}

/** Whether the paper's thumbnail URL serves an image. A 404 from raw.githubusercontent.com is a
 *  `text/plain` body, which myst refuses as an image, so any non-image answer or network error
 *  is false and the card goes without one. */
export async function thumbnailAvailable(entry, fetchImpl = fetch) {
  const { thumbUrl } = paperUrls(entry);
  try {
    const response = await fetchImpl(thumbUrl, { method: 'HEAD' });
    const type = response.headers?.get?.('content-type') ?? '';
    return Boolean(response.ok) && type.startsWith('image/');
  } catch {
    return false;
  }
}

/** Each URL is fetched once per process, though every edition page reads every paper's
 *  `myst.yml`. `myst start` keeps this module loaded across rebuilds, so the gallery shows each
 *  paper as it was at start. */
const cache = new Map();
function once(key, load) {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key);
}

/** {@link fetchPaperConfig} and {@link thumbnailAvailable}, each run once per paper per process. */
export function cachedPaperConfig(entry, fetchImpl = fetch) {
  return once(`config ${paperUrls(entry).configUrl}`, () => fetchPaperConfig(entry, fetchImpl));
}
export function cachedThumbnail(entry, fetchImpl = fetch) {
  return once(`thumb ${paperUrls(entry).thumbUrl}`, () => thumbnailAvailable(entry, fetchImpl));
}

/** Empties the fetch cache. For tests. */
export function clearCache() {
  cache.clear();
}

/**
 * The nodes one `paper-cards` block becomes: a grid of cards, or "No papers found." Fetches
 * every registered paper's `myst.yml`, since the edition is in it, and probes thumbnails only
 * for the papers shown. A paper with a sandbox DOI is left out, with a warning; a card with no
 * picture warns too.
 */
export async function renderCards(registry, opts = {}, fetchImpl = fetch) {
  const papers = await Promise.all(
    registry.map(async (entry) => ({ entry, config: await cachedPaperConfig(entry, fetchImpl) })),
  );
  const shown = selectEntries(papers, { edition: opts.edition }).filter(({ entry, config }) => {
    const doi = sandboxDoi(config);
    if (doi) {
      console.warn(
        `paper-cards: "${entry.id}" has a Zenodo sandbox DOI (${doi}), so it is left out of ` +
          `the list; run the Reserve DOI workflow with the sandbox unticked and merge its pull request.`,
      );
    }
    return !doi;
  });
  if (shown.length === 0) {
    return { type: 'paragraph', children: [{ type: 'text', value: 'No papers found.' }] };
  }
  const cards = await Promise.all(
    shown.map(async ({ entry, config }) => {
      const thumbnail = await cachedThumbnail(entry, fetchImpl);
      if (!thumbnail) {
        console.warn(
          `paper-cards: no image at ${paperUrls(entry).thumbUrl} for ` +
            `"${entry.id}"; its card has no picture.`,
        );
      }
      return cardFrom(entry, config, { thumbnail });
    }),
  );
  return { type: 'grid', columns: [1, 1, 2, 3], children: cards };
}

const paperCardsDirective = {
  name: 'paper-cards',
  doc: 'A gallery of cards, one per registered paper.',
  options: {
    edition: {
      type: String,
      doc: 'Only show papers whose own myst.yml sets this edition. Omit for every registered paper.',
    },
  },
  run(data) {
    // A directive runs synchronously, but the edition lives in each paper's myst.yml.
    // This node marks the block; {@link paperCardsTransform} fetches, filters and fills it.
    return [{ type: 'paper-cards-ref', registry: loadRegistry(), edition: data.options?.edition }];
  },
};

function paperCardsTransform(opts, utils) {
  return async (mdast) => {
    const nodes = utils.selectAll('paper-cards-ref', mdast);
    await Promise.all(
      nodes.map(async (node) => {
        const rendered = await renderCards(node.registry, { edition: node.edition });
        delete node.registry;
        delete node.edition;
        Object.assign(node, rendered);
      }),
    );
  };
}

const plugin = {
  name: 'Paper Gallery',
  directives: [paperCardsDirective],
  // See the header for why `document`.
  transforms: [{ plugin: paperCardsTransform, stage: 'document' }],
};

export default plugin;
