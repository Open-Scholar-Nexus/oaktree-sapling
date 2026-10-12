/**
 * gallery.mjs: the journal site's `paper-cards` directive (design §5; [S2]).
 *
 * A port of `impact-scholars.github.io/plugins/paper-gallery.mjs`, re-pointed from
 * `papers.txt` + a hardcoded org constant to the **registry** (`registry/papers.yml`,
 * design §9). Every URL is derived from a registry entry's `location`, never from an org
 * constant, so the same plugin serves any tenant. Title, keywords, edition and DOI come from
 * the paper's own `myst.yml`, fetched once per paper per build.
 *
 * This file is ENGINE-owned but is NOT engine TypeScript: myst consumes it at runtime by
 * tag-pinned raw URL (`project.plugins:` accepts remote `.mjs`, myst-cli `config.ts:415-419`),
 * so it never enters `dist/cli.cjs` and `myst.ts` stays the only importer of myst-cli.
 *
 * WHY IT MUST STAY DEPENDENCY-LIGHT: myst downloads a remote plugin into
 * `<project>/_build/cache/config-item-<hash>.mjs` and imports it from there, so every bare
 * import must resolve from the SITE repo's own `node_modules`: the mystmd install (an npx
 * cache) is not on that resolution path. `js-yaml` is therefore declared in the site
 * scaffold's `package.json` and installed by the site workflow. Add nothing else here
 * without adding it there too.
 *
 * FAILURE IS HARD, ON PURPOSE. A registry entry whose `myst.yml` will not fetch is a broken
 * registry: it must be fixed, not papered over. A failed build is not an outage, Pages keeps
 * serving the last successful deploy, so the live journal stays exactly as it was until the
 * entry is corrected. Degrading would publish a visibly broken card to readers and bury the
 * signal in a log nobody reads. Note the division of labour, CORRECTED by a live run ([R80]):
 * the `throw` below covers PER-PAPER failures (it propagates and crashes the build regardless
 * of flags); `--strict` covers errors raised while building a page (a bad DOI, a missing
 * image); and NEITHER covers "the plugin never loaded at all"; myst logs `Unknown plugin` +
 * `unknown directive` and still exits 0, deploying a gallery-less page over a good one. That
 * third case is caught in the site workflow by asserting this plugin's `name` appears in the
 * build log, which is why the name below is load-bearing: do not rename it casually.
 *
 * The THUMBNAIL is the one per-paper failure that degrades: a paper with no
 * `thumbnails/thumbnail.png` (a new paper, a renamed file) gets a card with no image, since
 * one missing picture is no reason to stop publishing the rest of the journal.
 * `thumbnailAvailable` probes the URL with a HEAD request; when it serves an image, the card
 * carries the remote URL and myst downloads it. This transform runs at `stage: 'document'`
 * (`process/mdast.ts:224`), i.e. BEFORE `transformImagesToDisk` (`:438`), so the URL is picked
 * up by `saveImageInStaticFolder` → `downloadAndSaveImage` (`transforms/images.ts:115-117`) and
 * written into the site's public folder under a content hash, so the published site serves its
 * own copy. Left in the card unprobed, a 404 is an
 * error-kind warning (`RuleId.imageDownloads`, `images.ts:82-88`) and `--strict` fails the whole
 * build on it.
 */
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

/** The registry, relative to the site build root. Fixed, not an option: [S8] fixed the repo
 *  layout (the site IS the instance-config repo), so a `:registry:` option would be
 *  configurability for a layout that cannot occur. Adding one later stays compatible. */
export const REGISTRY_PATH = 'registry/papers.yml';

/** Read + parse the registry. A missing/malformed registry is fatal: without it the page
 *  would deploy with an empty gallery, which reads as "this journal has no papers". */
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
    throw new Error(`paper-cards: "${file}" must be a LIST of registry entries (design §9).`);
  }
  return entries;
}

const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.\.?$)[A-Za-z0-9._-]+$/;

/** A registry `location`: `{ repo }` for `owner/name`, `{ path }` for a `./` or `../` folder in
 *  the journal repo, else null. A copy of `parseLocation` in `src/schema.ts`, held to it by
 *  `location rule parity` in `test/gallery.test.ts`. */
export function parseLocation(value) {
  if (typeof value !== 'string') return null;
  if (/^\.\.?\//.test(value)) return { path: value };
  if (GITHUB_REPO.test(value)) return { repo: value };
  return null;
}

/** A paper's edition, from its fetched `myst.yml`, or undefined. */
export function editionOf(config) {
  return config?.project?.options?.['oaktree-sapling']?.edition;
}

/**
 * The papers a `:::{paper-cards}` block shows, in **registry file order**: the editor
 * controls sequence by where they insert the entry, which is the one ordering rule that
 * needs no extra field. `edition` omitted → every registered paper (what the scaffold's
 * single page uses); a fresh journal has exactly one edition, and a tenant who grows a
 * second one adds a page and filters it ([S6]). `papers` pairs each entry with its fetched
 * `myst.yml`, which holds the edition.
 */
export function selectEntries(papers, opts = {}) {
  const { edition } = opts;
  return edition ? papers.filter(({ config }) => editionOf(config) === edition) : [...papers];
}

/**
 * The three URLs a card is built from. The ONE place [S4]'s shape shows up, and the one
 * place that changes if we ever read a built `myst.json` instead of the raw `myst.yml`.
 *
 * `site_url` is honored when present (custom domains, non-Pages hosting) and otherwise
 * derived from the repository. Raw URLs go through **`HEAD`**, not `main`, so a tenant
 * whose default branch is named otherwise still resolves. The thumbnail path is not a
 * guess: `paper-base.yml` pins `project.thumbnail: thumbnails/thumbnail.png` for every paper.
 * Throws for a relative path, a folder in the journal repo, which the website does not list yet.
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
  const [owner, name] = repo.split('/');
  const raw = `https://raw.githubusercontent.com/${repo}/HEAD/`;
  return {
    siteUrl: entry.site_url ?? `https://${owner.toLowerCase()}.github.io/${name}`,
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
 * One card node, PURE: (registry entry, that paper's fetched myst config) → mdast. Title,
 * keywords and DOI come from the paper (the registry stays a thin pointer list, [S4]).
 * `opts.thumbnail: false` leaves the image out (see `thumbnailAvailable`).
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
  // The DOI is TEXT, deliberately not a link. myst converts any `link` whose url is a DOI
  // into a `cite` node (`myst-cli/transforms/dois.ts:239-242`, no per-node opt-out), which
  // on a gallery card is wrong twice over: the card would render a citation label plus a
  // stray bibliography instead of the identifier, and each card would cost a doi.org
  // metadata fetch per build: rate-limited upstream, and one unreachable DOI fails the
  // whole journal under `--strict`. Found on the first live run, with a sandbox DOI.
  // The card itself already links to the paper, whose own page carries a real DOI link.
  if (doi) {
    children.push({
      type: 'footer',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: `DOI: ${doi}` }] }],
    });
  }
  return { type: 'card', url: siteUrl, children };
}

/** Fetch one paper's myst config. Throws naming BOTH the entry's id and the URL, because the fix
 *  is a registry edit and the editor needs to know which line to edit. */
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

/** One fetch per URL per process: a page per edition reads every paper's `myst.yml`. `myst
 *  start` keeps this module loaded across rebuilds, so it shows each paper as it was at start. */
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
          `the list; run Prepare Zenodo deposit with the sandbox unticked and merge its pull request.`,
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
    // The directive is sync and the edition is in each paper's myst.yml, so
    // {@link paperCardsTransform} fetches and filters; this placeholder carries the block across.
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
  // `stage: 'document'` is load-bearing, not incidental; see the thumbnail note at the top.
  transforms: [{ plugin: paperCardsTransform, stage: 'document' }],
};

export default plugin;
