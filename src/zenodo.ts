/**
 * `oak deposit` (prepare, publish, status), and the core of `oak release`.
 *
 *  - The journal's description paragraph and Zenodo community come from `journal.yml`
 *    `zenodo:`; both are optional [R19]. See `loadJournalZenodo`.
 *  - Every lookup pages through all depositions [R20] [R35.1]: an account can hold more than a
 *    page, and a missed match makes `prepare` mint a second concept DOI.
 *  - A deposit is identified by the paper's `project.id`, stored as a URN
 *    (`urn:oaktree-sapling:<id>`) beside the GitHub URL and looked up first, so it survives the
 *    repo moving [R7] [design §9].
 *  - Extra files come from the paper's `deposit/` folder and upload as they are, beside oak's
 *    fixed files; a name clash with those is an error [R28].
 *  - The review pull request in the provenance comes from `gh api` (`GitContext.reviewPr`)
 *    [R35.2].
 *
 * Every command returns one JSON result with a `status` field, which the workflows read. A draft
 * is reused when one exists, `--sandbox` switches endpoints, and publish overwrites the metadata
 * [R22].
 *
 * The Zenodo HTTP transport and the git and gh side are injected, so tests need neither network
 * nor git; the real ones are `createFetchTransport()` and gh.ts. The abstract is read from the
 * HTML build's JSON on disk, so this module needs no myst-cli.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve, basename, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { readDoc, writeDoc, DERIVED_CONFIG_FILE } from './yaml-io.js';
import { JournalConfig, type ZenodoConfig } from './schema.js';

export const ZENODO_PROD = 'https://zenodo.org/api';
export const ZENODO_SANDBOX = 'https://sandbox.zenodo.org/api';
const PREFIX_PROD = '10.5281/zenodo.';
const PREFIX_SANDBOX = '10.5072/zenodo.';

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** Extra document part appended to the Zenodo description (e.g. shared authorship). */
const ZENODO_EXTRA_PART = 'zenodo_extra_description';

/** oak's five fixed deposit files; a `deposit/` file may not take their names [R28]. Exported
 *  so conformance can check the release carries exactly these. */
export const RESERVED_BUNDLE_NAMES = [
  'paper.pdf',
  'source.zip',
  'myst.yml',
  'publication-provenance.json',
  'engine.zip',
];

/** The sixth file, only when the template used is not already in `engine.zip` (a journal's or an
 *  author's) [R76]. Reserved against `deposit/` names, but kept out of RESERVED_BUNDLE_NAMES, the
 *  set conformance expects on every deposit. */
export const TEMPLATE_BUNDLE_NAME = 'template.zip';

/** Every name oak may write into the bundle, which a `deposit/` file may not take. */
export const RESERVED_DEPOSIT_NAMES = [...RESERVED_BUNDLE_NAMES, TEMPLATE_BUNDLE_NAME];

/** The reserved names a `deposit/` folder uses. The one statement of the [R28] rule: `oak
 *  validate` reports it on the pull request, `oak release` refuses on it [R101]. */
export function depositCollisions(names: string[]): string[] {
  return names.filter((n) => RESERVED_DEPOSIT_NAMES.includes(n));
}

export function apiBase(sandbox: boolean): string {
  return sandbox ? ZENODO_SANDBOX : ZENODO_PROD;
}
function doiPrefix(sandbox: boolean): string {
  return sandbox ? PREFIX_SANDBOX : PREFIX_PROD;
}
export function isSandboxDoi(doi: string): boolean {
  return doi.startsWith(PREFIX_SANDBOX);
}

/** The paper's identity on Zenodo [R7]: a URN independent of where the paper lives, stored as a
 *  related identifier so it survives the GitHub URL changing. */
export function paperUrn(id: string): string {
  return `urn:oaktree-sapling:${id}`;
}

/* --------------------------------------------------------------------------
 * HTTP transport (injected)
 * ------------------------------------------------------------------------ */

export interface TransportResponse {
  ok: boolean;
  status: number;
  text: string;
  json(): unknown;
}

export interface ZenodoTransport {
  request(
    method: string,
    url: string,
    opts: {
      params?: Record<string, string | number>;
      json?: unknown;
      body?: Uint8Array;
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<TransportResponse>;
}

/** The real transport, using `fetch`. The token goes as a query parameter; a non-2xx logs the
 *  body to stderr. */
export function createFetchTransport(): ZenodoTransport {
  return {
    async request(method, url, opts) {
      const u = new URL(url);
      for (const [k, v] of Object.entries(opts.params ?? {})) u.searchParams.set(k, String(v));
      const headers: Record<string, string> = { ...opts.headers };
      let body: string | Uint8Array | undefined;
      if (opts.json !== undefined) {
        body = JSON.stringify(opts.json);
        headers['Content-Type'] = 'application/json';
      } else if (opts.body !== undefined) {
        body = opts.body;
      }
      const res = await fetch(u, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      const text = await res.text();
      if (!res.ok) {
        process.stderr.write(
          `\n[zenodo ${method} ${u.pathname}] ${res.status}\n  ${text.slice(0, 2000)}\n`,
        );
      }
      return { ok: res.ok, status: res.status, text, json: () => (text ? JSON.parse(text) : null) };
    },
  };
}

/* --------------------------------------------------------------------------
 * git and gh (injected; the real ones are in gh.ts)
 * ------------------------------------------------------------------------ */

export interface GitContext {
  /** `git -C <root> rev-parse HEAD`. */
  headSha(repoRoot: string): Promise<string>;
  /** `git -C <root> archive --format=zip -o <outZip> HEAD`. */
  gitArchive(repoRoot: string, outZip: string): Promise<void>;
  /** The pull request that introduced <sha>, via `gh api` [R35.2]; null when there is none or
   *  gh is unavailable. */
  reviewPr(repoRoot: string, sha: string): Promise<string | null>;
}

/* --------------------------------------------------------------------------
 * Zenodo API (every lookup pages through all results [R20] [R35.1])
 * ------------------------------------------------------------------------ */

// Depositions are loosely typed: Zenodo owns the shape, we read a few fields by name.
export type Deposition = Record<string, any>;

export class ZenodoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class ZenodoApi {
  /** The API host, derived from `sandbox` so the two cannot disagree [R107]. */
  readonly api: string;

  constructor(
    private readonly t: ZenodoTransport,
    readonly sandbox: boolean,
    private readonly token: string,
  ) {
    this.api = apiBase(sandbox);
  }

  private async call(
    method: string,
    path: string,
    opts: Parameters<ZenodoTransport['request']>[2] = {},
  ): Promise<TransportResponse> {
    const params = { ...opts.params, access_token: this.token };
    const res = await this.t.request(method, `${this.api}${path}`, { ...opts, params });
    if (!res.ok)
      throw new ZenodoError(`Zenodo ${method} ${path} → ${res.status}`, res.status, res.text);
    return res;
  }

  /** Lists depositions page by page (`size=100`) until a short page [R20]. */
  async listMyDepositions(opts: { q?: string } = {}): Promise<Deposition[]> {
    const size = 100;
    const out: Deposition[] = [];
    for (let page = 1; ; page++) {
      const params: Record<string, string | number> = { size, page };
      if (opts.q) params.q = opts.q;
      const res = await this.call('GET', '/deposit/depositions', { params });
      const batch = res.json() as Deposition[];
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch);
      if (batch.length < size) break;
    }
    return out;
  }

  async getDeposition(depId: string | number): Promise<Deposition> {
    return (await this.call('GET', `/deposit/depositions/${depId}`)).json() as Deposition;
  }

  async createDeposition(metadata: Record<string, unknown>): Promise<Deposition> {
    return (
      await this.call('POST', '/deposit/depositions', { json: { metadata } })
    ).json() as Deposition;
  }

  async updateMetadata(
    depId: string | number,
    metadata: Record<string, unknown>,
  ): Promise<Deposition> {
    return (
      await this.call('PUT', `/deposit/depositions/${depId}`, { json: { metadata } })
    ).json() as Deposition;
  }

  async uploadFile(bucketUrl: string, name: string, data: Uint8Array): Promise<void> {
    // The bucket PUT takes a bare URL (outside `/api`), so it skips `call`'s path join. The name
    // comes from the author, so it is encoded: a raw `?` would end the path and append to the
    // query string that carries the token [R107].
    const res = await this.t.request('PUT', `${bucketUrl}/${encodeURIComponent(name)}`, {
      params: { access_token: this.token },
      body: data,
      timeoutMs: 600_000,
    });
    if (!res.ok) throw new ZenodoError(`upload ${name} → ${res.status}`, res.status, res.text);
  }

  /**
   * Finds the deposition by id, then by GitHub URL [R7]: targeted `q` queries first (each paged),
   * then a full scan when neither found the identifier. The scan depends on a match, not on rows
   * coming back, since `q` matches phrases and a near miss returns rows [R100].
   */
  async findDeposit(opts: { paperId?: string; githubUrl: string }): Promise<Deposition | null> {
    const urn = opts.paperId ? paperUrn(opts.paperId) : null;

    if (urn) {
      const hit = matchRelated(
        await this.listMyDepositions({ q: `related.identifier:"${urn}"` }),
        urn,
      );
      if (hit) return hit;
    }
    const byUrl = matchRelated(
      await this.listMyDepositions({ q: `related.identifier:"${opts.githubUrl}"` }),
      opts.githubUrl,
    );
    if (byUrl) return byUrl;

    const all = await this.listMyDepositions();
    return (urn && matchRelated(all, urn)) || matchRelated(all, opts.githubUrl) || null;
  }

  /** The newest deposition for a concept DOI (paged, the third lookup [R35.1]). */
  async latestVersionDepId(conceptDoi: string): Promise<number | null> {
    let items = await this.listMyDepositions({ q: `conceptdoi:"${conceptDoi}"` });
    if (items.length === 0) {
      const m = /zenodo\.(\d+)/.exec(conceptDoi);
      if (m) items = await this.listMyDepositions({ q: `conceptrecid:${m[1]}` });
    }
    items.sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
    return items[0]?.id ?? null;
  }
}

function matchRelated(items: Deposition[], identifier: string): Deposition | null {
  for (const it of items) {
    for (const ri of it.metadata?.related_identifiers ?? []) {
      if (ri.identifier === identifier) return it;
    }
  }
  return null;
}

/** The deposition's concept DOI. `conceptdoi` is only set after first publish; before that,
 *  build it from `conceptrecid`. */
export function conceptDoiFor(dep: Deposition, sandbox: boolean): string {
  return dep.conceptdoi ?? `${doiPrefix(sandbox)}${dep.conceptrecid}`;
}

/* --------------------------------------------------------------------------
 * Description parts, read from the myst HTML build's JSON (no myst-cli)
 * ------------------------------------------------------------------------ */

const TEXT_LEAVES = new Set(['text', 'inlineMath', 'inlineCode']);

function flattenText(node: any, buf: string[]): void {
  if (TEXT_LEAVES.has(node?.type)) {
    buf.push(node.value ?? '');
    return;
  }
  for (const child of node?.children ?? []) flattenText(child, buf);
}

/**
 * Plain-text paragraphs of a frontmatter part, from the HTML build
 * (`_build/site/content/<page>.json`, `frontmatter.parts.<name>.mdast`). Zenodo renders neither
 * math nor markup, so it is flattened to text. null when the part is absent or nothing was built
 * (as at prepare, which does not build).
 */
export function partParagraphs(repoRoot: string, partName: string): string[] | null {
  const contentDir = join(repoRoot, '_build', 'site', 'content');
  if (!existsSync(contentDir)) return null;
  const files = readdirSync(contentDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const f of files) {
    let data: any;
    try {
      data = JSON.parse(readFileSync(join(contentDir, f), 'utf8'));
    } catch {
      continue;
    }
    const part = data?.frontmatter?.parts?.[partName];
    const mdast = part && typeof part === 'object' ? (part.mdast ?? part) : part;
    if (!mdast || typeof mdast !== 'object') continue;
    const paras: string[] = [];
    const visit = (node: any): void => {
      if (node?.type === 'paragraph') {
        const buf: string[] = [];
        flattenText(node, buf);
        const text = buf.join('').trim();
        if (text) paras.push(text);
        return; // don't descend past a paragraph
      }
      for (const child of node?.children ?? []) visit(child);
    };
    visit(mdast);
    if (paras.length === 0) {
      const buf: string[] = [];
      flattenText(mdast, buf);
      const text = buf.join('').trim();
      if (text) paras.push(text);
    }
    if (paras.length > 0) return paras;
  }
  return null;
}

/** Whether the HTML build left content JSON here. Without it the parts {@link partParagraphs}
 *  reads were never produced, which differs from a paper that declares none [R107]. */
export function hasBuildContent(repoRoot: string): boolean {
  return existsSync(join(repoRoot, '_build', 'site', 'content'));
}

export const abstractParagraphs = (repoRoot: string): string[] | null =>
  partParagraphs(repoRoot, 'abstract');
export const zenodoExtraParagraphs = (repoRoot: string): string[] | null =>
  partParagraphs(repoRoot, ZENODO_EXTRA_PART);

/* --------------------------------------------------------------------------
 * Metadata (the journal's parts come from journal.yml [R19])
 * ------------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function youtubeUrl(project: any): string | null {
  const fromOptions = project.options?.youtube;
  if (fromOptions) return String(fromOptions).trim();
  const fromSocial = project.social?.youtube;
  if (fromSocial) return String(fromSocial).trim();
  return null;
}

export interface MetadataInput {
  project: any;
  paperId?: string;
  githubUrl: string;
  siteUrl?: string;
  zenodo: ZenodoConfig;
  version?: string;
  publicationDate?: string;
  abstractParas?: string[] | null;
  extraDescParas?: string[] | null;
}

/**
 * Builds the deposition metadata from a myst project and the journal's `zenodo:` settings. The
 * description is HTML paragraphs (abstract, journal paragraph, extra part, links), and the
 * identity URN sits beside the GitHub URL [R7].
 */
export function buildMetadata(input: MetadataInput): Record<string, unknown> {
  const {
    project,
    paperId,
    githubUrl,
    siteUrl,
    zenodo,
    version,
    publicationDate,
    abstractParas,
    extraDescParas,
  } = input;

  const creators: Array<Record<string, string>> = [];
  for (const a of project.authors ?? []) {
    const c: Record<string, string> = { name: String(a.name) };
    const affs = a.affiliations ?? [];
    if (affs.length) c.affiliation = String(affs[0]);
    const orcid = String(a.orcid ?? '');
    // Zenodo replaces `name` from the ORCID profile when the ORCID does not resolve, so invalid
    // and placeholder ORCIDs (the template's 0000-0000-...) are dropped.
    if (orcid && ORCID_RE.test(orcid) && !orcid.startsWith('0000-0000-')) {
      c.orcid = orcid;
    } else if (orcid) {
      process.stderr.write(`[warn] skipping invalid/placeholder ORCID for ${a.name}: ${orcid}\n`);
    }
    creators.push(c);
  }

  const keywords = (project.keywords ?? []).map((k: unknown) => String(k));
  const licenseId = String(project.license ?? 'cc-by-4.0').toLowerCase();

  const desc: string[] = [];
  if (abstractParas) desc.push(...abstractParas.map((p) => `<p>${escapeHtml(p)}</p>`));
  // The journal's optional paragraph [R19].
  if (zenodo.description_blurb) desc.push(`<p>${escapeHtml(zenodo.description_blurb)}</p>`);
  if (extraDescParas) desc.push(...extraDescParas.map((p) => `<p>${escapeHtml(p)}</p>`));
  const yt = youtubeUrl(project);
  if (yt) desc.push(`<p>Seminar Recording: <a href="${escapeHtml(yt)}">Watch on YouTube</a></p>`);
  if (siteUrl) desc.push(`<p>Project Website: <a href="${siteUrl}">${siteUrl}</a></p>`);
  desc.push(`<p>Repository: <a href="${githubUrl}">${githubUrl}</a></p>`);
  const venue = project.venue;
  if (venue) {
    const v = typeof venue === 'string' ? venue : (venue.title ?? String(venue));
    desc.push(`<p>Venue: ${v}</p>`);
  }
  if (project.funding) desc.push(`<p>Funding: ${project.funding}</p>`);

  const related: Array<Record<string, string>> = [
    { identifier: githubUrl, relation: 'isVersionOf', scheme: 'url' },
  ];
  // The identity URN [R7], which survives a repo move.
  if (paperId)
    related.push({ identifier: paperUrn(paperId), relation: 'isVersionOf', scheme: 'urn' });
  if (siteUrl) related.push({ identifier: siteUrl, relation: 'isIdenticalTo', scheme: 'url' });
  if (yt) related.push({ identifier: yt, relation: 'isSupplementedBy', scheme: 'url' });

  const md: Record<string, unknown> = {
    upload_type: 'publication',
    publication_type: 'article',
    title: String(project.title),
    creators,
    description: desc.join(''),
    license: licenseId,
    related_identifiers: related,
    access_right: 'open',
  };
  // The journal's optional community [R19].
  if (zenodo.community) md.communities = [{ identifier: zenodo.community }];
  if (keywords.length) md.keywords = keywords;
  if (version !== undefined) md.version = version;
  const pubdate = publicationDate ?? project.date;
  if (pubdate) md.publication_date = String(pubdate);
  return md;
}

/* --------------------------------------------------------------------------
 * Bundle assembly from the `deposit/` folder [R28]
 * ------------------------------------------------------------------------ */

export interface BundleProvenance {
  repo: string;
  commit_sha: string;
  tag: string;
  site_url: string | undefined;
  concept_doi: string;
  version_doi: string;
  review_pr: string | null;
  built_at: string;
  // What it takes to render the deposit again [R34] [R66]: engine.zip carries everything but
  // node, so this platform and node.
  platform: string;
  typst_version: string | null;
}

/* --------------------------------------------------------------------------
 * The typst template used, archived into the deposit [R76] [R66]
 * ------------------------------------------------------------------------ */

export class TemplateArchiveError extends Error {}

/** The file that marks a directory as a myst template [R107]. */
const TEMPLATE_YML = 'template.yml';

/**
 * The typst template the build used, read from the derived config `myst.oak.yml` that the build
 * leaves beside `myst.yml` [R71]. The deposit archives what was rendered, so it reads the
 * stamped value and does not work the precedence out again.
 *
 * Falls back to the author's `myst.yml` when there is no derived config (the tree was not built
 * here), and to null when neither names one: oak's own template, already in `engine.zip`.
 */
export function readStampedTemplate(paperRoot: string): string | null {
  for (const file of [DERIVED_CONFIG_FILE, 'myst.yml']) {
    const path = join(paperRoot, file);
    if (!existsSync(path)) continue;
    const exports = readDoc(path).getIn(['project', 'exports']) as
      { toJSON?: () => unknown } | undefined;
    const list = (exports?.toJSON?.() ?? exports) as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(list)) continue;
    const typst = list.find((e) => e['format'] === 'typst' || e['id'] === 'typst-pdf');
    const template = typst?.['template'];
    if (typeof template === 'string' && template) return template;
  }
  return null;
}

/**
 * Where myst put a template on disk, restating myst-templates' `resolveInputs` (a short,
 * documented mapping) so this module needs no myst dependency. A local path is used in place; a
 * URL goes to `_build/templates/<kind>/<sha256(url)>`; a bare name to
 * `_build/templates/<kind>/<namespace>/<name>`. Every form ends up as a directory, so one
 * bundling rule covers all three [R74].
 */
export function resolveTemplateDir(template: string, paperRoot: string): string {
  const buildTemplates = join(paperRoot, '_build', 'templates');

  // Local: a directory with a `template.yml`, or a path to one inside such a directory. myst
  // requires `template.yml` too [R107]; without it a directory sharing a registry template's
  // name would be archived in place of what was rendered.
  //
  // Resolved against the paper root, where myst resolved it during the build (myst.ts changes
  // into the paper root). The deposit may run from anywhere, and resolving against its cwd would
  // miss a valid local template and refuse the deposit.
  const local = isAbsolute(template) ? template : join(paperRoot, template);
  if (existsSync(local)) {
    const dir = statSync(local).isDirectory() ? local : resolve(local, '..');
    if (existsSync(join(dir, TEMPLATE_YML))) return dir;
  }

  if (/^[a-zA-Z][\w+.-]*:\/\//.test(template)) {
    return join(buildTemplates, 'typst', createHash('sha256').update(template).digest('hex'));
  }

  // A name, in one of myst's three shapes: `x` → typst/myst/x, `a/b` → typst/a/b,
  // `typst/a/b` → itself.
  const parts = template.split('/');
  const normalized =
    parts.length === 1
      ? ['typst', 'myst', ...parts]
      : parts.length === 2
        ? ['typst', ...parts]
        : parts;
  return join(buildTemplates, ...normalized);
}

/**
 * The template directory this deposit must archive, or null when nothing needs adding: when the
 * template is inside oak's checkout, already archived as `engine.zip`. Then the bundle is the
 * five fixed files conformance expects.
 *
 * Otherwise the bytes are in no other file, and without them the PDF behind the DOI could not be
 * rendered again [design §7] [R66], so a template that cannot be found is an error.
 */
export function templateArchiveDir(paperRoot: string, engineRoot: string): string | null {
  const template = readStampedTemplate(paperRoot);
  if (!template) return null;

  const dir = resolveTemplateDir(template, paperRoot);
  const rel = relative(resolve(engineRoot), resolve(dir));
  const insideEngine = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (insideEngine) return null;

  if (!existsSync(dir)) {
    throw new TemplateArchiveError(
      `typst template "${template}" resolves to "${dir}", which does not exist, so the ` +
        `deposit cannot archive the template it rendered with. A non-engine template rides ` +
        `in no other deposit artifact; publishing without it would give a DOI'd PDF that ` +
        `cannot be reproduced. Run the build in this working tree before depositing.`,
    );
  }
  return dir;
}

/**
 * What can make a deposit impossible, in one place so a caller can check before writing to
 * Zenodo [R101]. `oak validate` reports the same clash on the pull request
 * ({@link depositCollisions}).
 */
export function assertBundlePreconditions(repoRoot: string, engineRoot: string): void {
  const depositDir = join(repoRoot, 'deposit');
  const extras = existsSync(depositDir)
    ? readdirSync(depositDir).filter((n) => statSync(join(depositDir, n)).isFile())
    : [];
  const collisions = depositCollisions(extras);
  if (collisions.length) {
    throw new BundleCollisionError(
      `deposit/ file(s) collide with engine-reserved names: ${collisions.join(', ')}. ` +
        `Rename them: ${RESERVED_DEPOSIT_NAMES.join(', ')} are added by the engine.`,
    );
  }
  templateArchiveDir(repoRoot, engineRoot);
}

/**
 * Assembles the deposit: oak's five fixed files plus every file in the paper's `deposit/`
 * folder, as they are [R28]; a clash with a fixed name is an error. Returns the paths, sorted.
 *
 * `engine.zip` is a `git archive` of oak at its pinned release [R34] [R66], which carries
 * `bin/typst`, `dist/cli.cjs` and `templates/typst/`: everything but node needed to render the
 * PDF again, on linux x86_64. A sixth file, `template.zip`, holds a template that is not oak's
 * own [R76]; see {@link templateArchiveDir}.
 */
export async function buildBundle(
  out: string,
  pdf: string,
  repoRoot: string,
  engineRoot: string,
  provenance: BundleProvenance,
  git: GitContext,
): Promise<string[]> {
  assertBundlePreconditions(repoRoot, engineRoot);
  const depositDir = join(repoRoot, 'deposit');
  const extras = existsSync(depositDir)
    ? readdirSync(depositDir).filter((n) => statSync(join(depositDir, n)).isFile())
    : [];

  const templateDir = templateArchiveDir(repoRoot, engineRoot);

  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  copyFileSync(pdf, join(out, 'paper.pdf'));
  await git.gitArchive(repoRoot, resolve(join(out, 'source.zip')));
  await git.gitArchive(engineRoot, resolve(join(out, 'engine.zip')));
  assertEngineArchive(join(out, 'engine.zip'));
  const mystSrc = join(repoRoot, 'myst.yml');
  if (existsSync(mystSrc)) copyFileSync(mystSrc, join(out, 'myst.yml'));
  if (templateDir) {
    const zip = new AdmZip();
    zip.addLocalFolder(templateDir);
    zip.writeZip(join(out, TEMPLATE_BUNDLE_NAME));
  }
  writeFileSync(
    join(out, 'publication-provenance.json'),
    JSON.stringify(provenance, null, 2) + '\n',
  );
  for (const n of extras) copyFileSync(join(depositDir, n), join(out, n));

  return readdirSync(out)
    .filter((n) => statSync(join(out, n)).isFile())
    .sort()
    .map((n) => join(out, n));
}

export class BundleCollisionError extends Error {}

/** oak's checkout could not produce an `engine.zip` that renders on its own [R107]. */
export class EngineArchiveError extends Error {}

/** What `engine.zip` must carry to render the PDF again [R34] [R66]. Both are committed only at
 *  release tags, so any other ref archives a zip without them [R107]. */
const ENGINE_ARCHIVE_REQUIRED = ['dist/cli.cjs', 'bin/typst'];

/** Refuses an `engine.zip` that cannot render the PDF it is deposited beside [R107]. */
function assertEngineArchive(zipPath: string): void {
  let names: string[] = [];
  try {
    names = new AdmZip(zipPath).getEntries().map((e) => e.entryName);
  } catch {
    // An unreadable file counts as carrying nothing, and is refused the same way.
  }
  const missing = ENGINE_ARCHIVE_REQUIRED.filter((n) => !names.includes(n));
  if (missing.length) {
    throw new EngineArchiveError(
      `engine.zip carries no ${missing.join(', ')}, so the deposit could not re-render its own ` +
        `PDF. The engine checkout is not a release ref: deposit from a released engine tag.`,
    );
  }
}

/* --------------------------------------------------------------------------
 * journal.yml `zenodo:` settings [R19]
 * ------------------------------------------------------------------------ */

/** Reads the journal's `zenodo:` block from `<instanceRoot>/journal.yml`. A new journal, or a
 *  build with no journal, gets empty defaults. */
export function loadJournalZenodo(instanceRoot: string | null): ZenodoConfig {
  if (!instanceRoot) return JournalConfig.parse({ name: 'x' }).zenodo;
  const path = join(instanceRoot, 'journal.yml');
  if (!existsSync(path)) return JournalConfig.parse({ name: 'x' }).zenodo;
  const doc = readDoc(path);
  const journal = JournalConfig.parse(doc.toJS() ?? {});
  return journal.zenodo;
}

/* --------------------------------------------------------------------------
 * Result envelope
 * ------------------------------------------------------------------------ */

export interface Outcome {
  exitCode: number;
  /** Always has `status: 'ok' | 'error'`, which the workflows read. */
  result: Record<string, unknown>;
}

const ok = (fields: Record<string, unknown>): Outcome => ({
  exitCode: 0,
  result: { status: 'ok', ...fields },
});
const err = (exitCode: number, message: string, fields: Record<string, unknown> = {}): Outcome => ({
  exitCode,
  result: { status: 'error', message, ...fields },
});

function projectOf(doc: ReturnType<typeof readDoc>): any {
  const p = doc.get('project');
  return (p && typeof (p as any).toJSON === 'function' ? (p as any).toJSON() : p) ?? {};
}

/* --------------------------------------------------------------------------
 * Commands
 * ------------------------------------------------------------------------ */

export interface PrepareInput {
  mystPath: string;
  repo: string; // owner/repo
  siteUrl?: string;
  api: ZenodoApi;
  instanceRoot: string | null;
}

/**
 * `oak deposit prepare`: reserves a draft, or reuses one, and writes `project.doi`, `github` and
 * `date` into myst.yml [R22]. The CLI opens the DOI pull request from that write [R3].
 *
 * Preparing again in the same environment is refused. A production prepare may replace a
 * committed sandbox DOI, the planned move from sandbox to production; the reverse is refused
 * [R29].
 */
export async function cmdPrepare(input: PrepareInput): Promise<Outcome> {
  const { mystPath, repo, siteUrl, api, instanceRoot } = input;
  const sandbox = api.sandbox;
  const doc = readDoc(mystPath);
  const project = projectOf(doc);

  const existingDoi: string | undefined = project.doi;
  if (existingDoi) {
    const existingSandbox = isSandboxDoi(existingDoi);
    if (existingSandbox === sandbox) {
      return err(2, `project.doi already set (${existingDoi}); prepare is for first deposit.`);
    }
    if (!existingSandbox && sandbox) {
      return err(2, `refusing to downgrade a production DOI (${existingDoi}) to sandbox.`);
    }
    // A sandbox DOI and a production prepare: replacing it is allowed [R29].
  }

  const doc2 = readDoc(mystPath); // fresh Document for the working-tree write (preserves comments)
  if (!doc2.getIn(['project', 'date'])) {
    doc2.setIn(['project', 'date'], new Date().toISOString().slice(0, 10));
  }

  const githubUrl = `https://github.com/${repo}`;
  const repoRoot = resolve(mystPath, '..');
  const md = buildMetadata({
    project: projectOf(doc2),
    paperId: project.id ? String(project.id) : undefined,
    githubUrl,
    siteUrl,
    zenodo: loadJournalZenodo(instanceRoot),
    abstractParas: abstractParagraphs(repoRoot),
    extraDescParas: zenodoExtraParagraphs(repoRoot),
  });
  md.prereserve_doi = true;

  const existing = await api.findDeposit({
    paperId: project.id ? String(project.id) : undefined,
    githubUrl,
  });
  let dep: Deposition;
  if (existing && existing.submitted === false) {
    process.stderr.write(`[prepare] reusing draft ${existing.id}\n`);
    dep = await api.updateMetadata(existing.id, md);
  } else if (existing) {
    return err(
      3,
      `Published deposit already exists (${existing.id}); refusing to create a parallel concept. ` +
        `Add its DOI to myst.yml manually.`,
    );
  } else {
    dep = await api.createDeposition(md);
  }

  const cdoi = conceptDoiFor(dep, sandbox);
  const draftUrl = dep.links?.html;

  doc2.setIn(['project', 'doi'], cdoi);
  doc2.setIn(['project', 'github'], githubUrl);
  writeDoc(mystPath, doc2);

  return ok({ concept_doi: cdoi, draft_url: draftUrl, deposition_id: dep.id });
}

export interface PublishInput {
  mystPath: string;
  pdf: string;
  tag: string;
  siteUrl?: string;
  bundleOut: string;
  api: ZenodoApi;
  git: GitContext;
  instanceRoot: string | null;
  /** oak's checkout (holds paper-base.yml), archived as the deposit's engine.zip. */
  engineRoot: string;
}

/** oak's pinned typst version, for the provenance; null without the pin file. The provenance
 *  records what it can and never blocks the deposit. */
function readTypstVersion(engineRoot: string): string | null {
  const path = join(engineRoot, 'typst.version');
  if (!existsSync(path)) return null;
  const v = readFileSync(path, 'utf8').trim();
  return v || null;
}

/**
 * `oak deposit publish`, also the core of `oak release`: fills the reserved draft with the final
 * metadata and files and leaves it unsubmitted. The environment follows the committed DOI's
 * prefix, so a tag cannot reach the wrong one [R4]; `--sandbox` must agree.
 */
export async function cmdPublish(input: PublishInput): Promise<Outcome> {
  const { mystPath, pdf, tag, siteUrl, bundleOut, api, git, instanceRoot, engineRoot } = input;
  const sandbox = api.sandbox;
  const doc = readDoc(mystPath);
  const project = projectOf(doc);

  const conceptDoi: string | undefined = project.doi;
  if (!conceptDoi)
    return err(2, 'project.doi missing; run prepare and merge that PR before tagging.');
  if (isSandboxDoi(conceptDoi) !== sandbox) {
    return err(2, `DOI prefix says sandbox=${isSandboxDoi(conceptDoi)} but --sandbox=${sandbox}.`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(tag))
    return err(2, `tag must match vMAJOR.MINOR.PATCH (got ${tag})`);
  const version = tag.slice(1);

  if (!existsSync(pdf)) return err(2, `--pdf not found: ${pdf}`);

  const githubUrl: string | undefined = project.github;
  if (!githubUrl) return err(2, 'project.github missing; should have been set by prepare.');

  const repoRoot = resolve(mystPath, '..');

  // Checked before anything is written to Zenodo, and reported in the result [R101].
  try {
    assertBundlePreconditions(repoRoot, engineRoot);
  } catch (e) {
    if (e instanceof BundleCollisionError || e instanceof TemplateArchiveError) {
      return err(2, e.message);
    }
    throw e;
  }

  // publish overwrites the metadata [R22], so publishing from a tree with no HTML build would
  // replace a description that has the abstract with one that does not [R107].
  if (!hasBuildContent(repoRoot)) {
    return err(
      2,
      `no myst build output under _build/site/content, so the deposit description would carry ` +
        `no abstract and overwrite one that does. Build this working tree before depositing.`,
    );
  }

  const latestId = await api.latestVersionDepId(conceptDoi);
  if (latestId === null) {
    return err(2, `No Zenodo record matches ${conceptDoi} (token mismatch? deleted draft?)`);
  }
  let dep = await api.getDeposition(latestId);

  const expectedConcept = `${doiPrefix(sandbox)}${dep.conceptrecid}`;
  if (conceptDoi !== expectedConcept) {
    return err(
      2,
      `Concept DOI sanity check failed: myst.yml has ${conceptDoi}, Zenodo's conceptrecid implies ${expectedConcept}`,
    );
  }

  if (dep.submitted) {
    // The CI token lacks `deposit:actions`, which a new version needs, so an editor clicks "New
    // version" on Zenodo to create the empty draft.
    const recordUrl = dep.links?.record_html ?? dep.links?.html;
    process.stderr.write(
      `::error title=Zenodo: editor must click 'New version'::No unsubmitted draft for this concept. ` +
        `Record: ${recordUrl ?? '(unavailable)'}\n`,
    );
    return err(
      5,
      `No unsubmitted Zenodo draft exists for this concept DOI.\n\n` +
        `An editor must open the record and click **New version** to spawn an empty draft, then re-run failed jobs.\n\n` +
        `Record: ${recordUrl ?? '(URL unavailable)'}`,
      { record_url: recordUrl },
    );
  }
  process.stderr.write(`[publish] reusing existing draft ${dep.id}\n`);

  const md = buildMetadata({
    project,
    paperId: project.id ? String(project.id) : undefined,
    githubUrl,
    siteUrl,
    zenodo: loadJournalZenodo(instanceRoot),
    version,
    publicationDate: String(project.date ?? new Date().toISOString().slice(0, 10)),
    abstractParas: abstractParagraphs(repoRoot),
    extraDescParas: zenodoExtraParagraphs(repoRoot),
  });
  dep = await api.updateMetadata(dep.id, md);

  const bucket = dep.links?.bucket;
  if (!bucket) return err(4, 'No bucket URL in deposition (unexpected Zenodo API shape).');

  // Predicted from the deposition id; matches what Zenodo assigns at publish.
  const predictedVersionDoi = `${doiPrefix(sandbox)}${dep.id}`;
  const sha = await git.headSha(repoRoot);
  const provenance: BundleProvenance = {
    repo: repoFromGithubUrl(githubUrl),
    commit_sha: sha,
    tag,
    site_url: siteUrl,
    concept_doi: conceptDoi,
    version_doi: predictedVersionDoi,
    review_pr: await git.reviewPr(repoRoot, sha),
    built_at: new Date().toISOString(),
    platform: 'linux-x86_64',
    typst_version: readTypstVersion(engineRoot),
  };
  let files: string[];
  try {
    files = await buildBundle(bundleOut, pdf, repoRoot, engineRoot, provenance, git);
  } catch (e) {
    if (e instanceof EngineArchiveError) return err(2, e.message);
    throw e;
  }

  for (const p of files) {
    process.stderr.write(`[publish] upload ${basename(p)}\n`);
    await api.uploadFile(bucket, basename(p), readFileSync(p));
  }

  dep = await api.getDeposition(dep.id);
  const versionDoi = dep.metadata?.doi ?? dep.doi ?? predictedVersionDoi;
  return ok({
    version_doi: versionDoi,
    draft_url: dep.links?.html,
    deposition_id: dep.id,
    bundle_dir: bundleOut,
  });
}

export interface StatusInput {
  mystPath: string;
  siteUrl?: string;
  api: ZenodoApi;
  instanceRoot: string | null;
}

/**
 * `oak deposit status`: the deposit's state for the committed concept DOI, and the metadata a
 * publish would send. Writes nothing.
 */
export async function cmdStatus(input: StatusInput): Promise<Outcome> {
  const { mystPath, siteUrl, api, instanceRoot } = input;
  const sandbox = api.sandbox;
  const doc = readDoc(mystPath);
  const project = projectOf(doc);
  const conceptDoi: string | undefined = project.doi;

  const out: Record<string, unknown> = {
    myst_path: mystPath,
    concept_doi: conceptDoi,
    github: project.github,
  };

  if (!conceptDoi) {
    out.state = 'no doi yet: prepare not run or PR not merged';
    return { exitCode: 0, result: out };
  }
  if (isSandboxDoi(conceptDoi) !== sandbox) {
    out.warning = `DOI prefix vs --sandbox mismatch (doi=${conceptDoi}, sandbox=${sandbox})`;
  }

  const latestId = await api.latestVersionDepId(conceptDoi);
  if (latestId === null) {
    out.state = 'no record matches';
    return { exitCode: 0, result: out };
  }
  const dep = await api.getDeposition(latestId);
  out.latest_deposition_id = dep.id;
  out.submitted = dep.submitted ?? false;
  out.draft_url = dep.links?.html;
  out.latest_version = dep.metadata?.version;
  out.latest_doi = dep.metadata?.doi ?? dep.doi;

  const repoRoot = resolve(mystPath, '..');
  const preview = buildMetadata({
    project,
    paperId: project.id ? String(project.id) : undefined,
    githubUrl: project.github ?? '',
    siteUrl: siteUrl ?? '',
    zenodo: loadJournalZenodo(instanceRoot),
    abstractParas: abstractParagraphs(repoRoot),
    extraDescParas: zenodoExtraParagraphs(repoRoot),
  });
  out.metadata_preview_keys = Object.keys(preview).sort();
  out.creator_count = (preview.creators as unknown[]).length;
  out.description_preview = preview.description;
  return { exitCode: 0, result: out };
}

export function repoFromGithubUrl(url: string): string {
  return url.replace(/\/+$/, '').split('github.com/').pop() ?? url;
}
