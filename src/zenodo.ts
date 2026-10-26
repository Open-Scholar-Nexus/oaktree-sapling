/**
 * `oak deposit` (prepare, publish, status), and the core of `oak release`, through Zenodo's
 * InvenioRDM API (`/api/records`).
 *
 *  - The journal's description paragraph and Zenodo community come from `journal.yml`
 *    `zenodo:`; both are optional [R19]. See `loadJournalZenodo` and `requestCommunity`.
 *  - Every lookup pages through all the account's records [R20] [R35.1]: an account can hold
 *    more than a page, and a missed match makes `prepare` mint a second concept DOI.
 *  - A deposit is identified by the paper's `project.id`, stored as a URN
 *    (`urn:oaktree-sapling:<id>`) beside the GitHub URL and looked up first, so it survives the
 *    repo moving [R7] [design §9].
 *  - Extra files come from the paper's `deposit/` folder and upload as they are, beside oak's
 *    fixed files; a name clash with those is an error [R28].
 *  - The review pull request in the provenance comes from `gh api` (`GitContext.reviewPr`)
 *    [R35.2].
 *  - The Project Website link is the paper's registry `site_url`, else its GitHub Pages URL,
 *    unless `--site-url` names one. See `defaultSiteUrl`.
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
import { validateProjectFrontmatter, type Name } from 'myst-frontmatter';
import {
  readDoc,
  readJournalConfig,
  writeDoc,
  readJournalStamp,
  DERIVED_CONFIG_FILE,
} from './yaml-io.js';
import {
  JournalConfig,
  locationRepo,
  pagesUrl,
  PAPER_VERSION_TAG,
  parseZenodoDoi,
  readRegistry,
  repoFromGithubUrl,
  sameRepo,
  zenodoDoiPrefix,
  type ZenodoConfig,
} from './schema.js';
import * as msg from './messages.js';
import { err, ok, type Outcome } from './result.js';

export const ZENODO_PROD = 'https://zenodo.org/api';
export const ZENODO_SANDBOX = 'https://sandbox.zenodo.org/api';

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** Extra document part appended to the Zenodo description (e.g. shared authorship). */
const ZENODO_EXTRA_PART = 'zenodo_extra_description';

/** oak's fixed deposit files; a `deposit/` file may not take their names [R28]. Exported so
 *  conformance can check the release carries these. */
export const RESERVED_BUNDLE_NAMES = [
  'paper.pdf',
  'source.zip',
  'myst.yml',
  DERIVED_CONFIG_FILE,
  'publication-provenance.json',
  'engine.zip',
];

/** Only when the template used is not already in `engine.zip` (a journal's or an author's)
 *  [R76]. Reserved against `deposit/` names, but kept out of RESERVED_BUNDLE_NAMES, the set
 *  conformance expects on every deposit. */
export const TEMPLATE_BUNDLE_NAME = 'template.zip';

/** Only when the journal is a repo of its own ({@link prepareJournalArchive}). Reserved against
 *  `deposit/` names, and kept out of RESERVED_BUNDLE_NAMES like {@link TEMPLATE_BUNDLE_NAME}. */
export const JOURNAL_BUNDLE_NAME = 'journal.zip';

/** Every name oak may write into the bundle, which a `deposit/` file may not take. */
export const RESERVED_DEPOSIT_NAMES = [
  ...RESERVED_BUNDLE_NAMES,
  TEMPLATE_BUNDLE_NAME,
  JOURNAL_BUNDLE_NAME,
];

/** The reserved names a `deposit/` folder uses. The one statement of the [R28] rule: `oak
 *  validate` reports it on the pull request, `oak release` refuses on it [R101]. */
export function depositCollisions(names: string[]): string[] {
  return names.filter((n) => RESERVED_DEPOSIT_NAMES.includes(n));
}

export function apiBase(sandbox: boolean): string {
  return sandbox ? ZENODO_SANDBOX : ZENODO_PROD;
}
function isSandboxDoi(doi: string): boolean {
  return doi.startsWith(zenodoDoiPrefix(true));
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
  /** `git -C <root> archive --format=zip -o <outZip> <commit>`, HEAD by default. */
  gitArchive(repoRoot: string, outZip: string, commit?: string): Promise<void>;
  /** Makes <commit> available in <root>, fetching it from origin when the clone lacks it;
   *  throws when it cannot. */
  fetchCommit(repoRoot: string, commit: string): Promise<void>;
  /** owner/repo from <root>'s origin remote, or null. */
  originRepo(repoRoot: string): Promise<string | null>;
  /** The pull request that introduced <sha>, via `gh api` [R35.2]; null when there is none or
   *  gh is unavailable. */
  reviewPr(repoRoot: string, sha: string): Promise<string | null>;
}

/* --------------------------------------------------------------------------
 * Zenodo's InvenioRDM API (every lookup pages through all results [R20] [R35.1])
 * ------------------------------------------------------------------------ */

/** Zenodo answers `/api/records` in its legacy shape unless asked for this one. */
const RDM_JSON = 'application/vnd.inveniordm.v1+json';

// Records are loosely typed: Zenodo owns the shape, we read a few fields by name.
export type ZenodoRecord = Record<string, any>;

/** What a draft is written with: the metadata, the custom fields, and open access to both. */
export interface DraftBody {
  metadata: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  access: { record: 'public'; files: 'public' };
  files: { enabled: true };
}

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
    const headers = { Accept: RDM_JSON, ...opts.headers };
    const res = await this.t.request(method, `${this.api}${path}`, { ...opts, params, headers });
    if (!res.ok)
      throw new ZenodoError(`Zenodo ${method} ${path} → ${res.status}`, res.status, res.text);
    return res;
  }

  /** The account's records and drafts, the latest version of each, page by page (`size=100`)
   *  until a short page [R20]. */
  async searchMyRecords(q?: string): Promise<ZenodoRecord[]> {
    const size = 100;
    const out: ZenodoRecord[] = [];
    for (let page = 1; ; page++) {
      const params: Record<string, string | number> = { size, page };
      if (q) params.q = q;
      const res = await this.call('GET', '/user/records', { params });
      const batch = (res.json() as { hits?: { hits?: ZenodoRecord[] } } | null)?.hits?.hits;
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch);
      if (batch.length < size) break;
    }
    return out;
  }

  async createDraft(body: DraftBody): Promise<ZenodoRecord> {
    return checkDraft((await this.call('POST', '/records', { json: body })).json());
  }

  /** Replaces the draft's metadata and custom fields; Zenodo keeps its reserved DOI. */
  async updateDraft(id: string, body: DraftBody): Promise<ZenodoRecord> {
    return checkDraft((await this.call('PUT', `/records/${id}/draft`, { json: body })).json());
  }

  async reserveDoi(id: string): Promise<ZenodoRecord> {
    return (await this.call('POST', `/records/${id}/draft/pids/doi`)).json() as ZenodoRecord;
  }

  /** A community's id from its slug, the last part of its address. */
  async communityId(slug: string): Promise<string> {
    const res = await this.call('GET', `/communities/${encodeURIComponent(slug)}`);
    return String((res.json() as { id: string }).id);
  }

  /** Makes the community the draft's review: publishing it then goes through the community. */
  async setCommunityReview(id: string, communityId: string): Promise<void> {
    await this.call('PUT', `/records/${id}/draft/review`, {
      json: { receiver: { community: communityId }, type: 'community-submission' },
    });
  }

  /** Removes every file the draft holds, those a new version imports included [R28]. */
  async clearDraftFiles(id: string): Promise<void> {
    const res = await this.call('GET', `/records/${id}/draft/files`);
    const entries = (res.json() as { entries?: Array<{ key: string }> } | null)?.entries ?? [];
    for (const { key } of entries) {
      await this.call('DELETE', `/records/${id}/draft/files/${encodeURIComponent(key)}`);
    }
  }

  /** Adds a file to the draft: declare, send the bytes, commit. The name comes from the author,
   *  so it is encoded: a raw `?` would end the path and append to the query string that
   *  carries the token [R107]. */
  async uploadFile(id: string, name: string, data: Uint8Array): Promise<void> {
    const file = `/records/${id}/draft/files/${encodeURIComponent(name)}`;
    await this.call('POST', `/records/${id}/draft/files`, { json: [{ key: name }] });
    await this.call('PUT', `${file}/content`, {
      body: data,
      headers: { 'Content-Type': 'application/octet-stream' },
      timeoutMs: 600_000,
    });
    await this.call('POST', `${file}/commit`);
  }

  /**
   * Finds the paper's record by id, then by GitHub URL [R7]: targeted `q` queries first (each
   * paged), then a full scan when neither found the identifier. The scan depends on a match, not
   * on rows coming back, since `q` matches phrases and a near miss returns rows [R100].
   */
  async findDeposit(opts: { paperId?: string; githubUrl: string }): Promise<ZenodoRecord | null> {
    const urn = opts.paperId ? paperUrn(opts.paperId) : null;
    const query = (id: string) => `metadata.related_identifiers.identifier:"${id}"`;

    if (urn) {
      const hit = matchRelated(await this.searchMyRecords(query(urn)), urn);
      if (hit) return hit;
    }
    const byUrl = matchRelated(await this.searchMyRecords(query(opts.githubUrl)), opts.githubUrl);
    if (byUrl) return byUrl;

    const all = await this.searchMyRecords();
    return (urn && matchRelated(all, urn)) || matchRelated(all, opts.githubUrl) || null;
  }

  /** The newest version of a concept DOI, a draft when there is one; null when the account holds
   *  none [R35.1]. It is re-read by id, since the search index can lag behind the record. */
  async latestVersion(conceptDoi: string): Promise<ZenodoRecord | null> {
    const parentId = parseZenodoDoi(conceptDoi)?.recordId;
    if (!parentId) return null;
    const items = await this.searchMyRecords(`parent.id:${parentId}`);
    items.sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
    const hit = items[0];
    if (!hit) return null;
    const path = hit.is_draft === true ? `/records/${hit.id}/draft` : `/records/${hit.id}`;
    return (await this.call('GET', path)).json() as ZenodoRecord;
  }
}

function matchRelated(items: ZenodoRecord[], identifier: string): ZenodoRecord | null {
  for (const it of items) {
    for (const ri of it.metadata?.related_identifiers ?? []) {
      if (ri.identifier === identifier) return it;
    }
  }
  return null;
}

/** Throws on the validation `errors` Zenodo saves a draft with, except missing files. */
function checkDraft(rec: unknown): ZenodoRecord {
  const r = rec as ZenodoRecord;
  const errors = (r?.errors ?? []).filter((e: any) => e?.field !== 'files.enabled');
  if (errors.length) {
    const text = errors.map((e: any) => `${e?.field}: ${(e?.messages ?? []).join(' ')}`).join('; ');
    throw new ZenodoError(`Zenodo draft ${r.id} has invalid metadata: ${text}`, 400, text);
  }
  return r;
}

/** The concept DOI. Zenodo mints it on first publish; before that, build it from the parent id. */
export function conceptDoiFor(rec: ZenodoRecord, sandbox: boolean): string {
  return rec.parent?.pids?.doi?.identifier ?? `${zenodoDoiPrefix(sandbox)}${rec.parent?.id}`;
}

/** The version DOI: the draft's reserved one, else the one Zenodo mints from the record id. */
function versionDoiFor(rec: ZenodoRecord, sandbox: boolean): string {
  return rec.pids?.doi?.identifier ?? `${zenodoDoiPrefix(sandbox)}${rec.id}`;
}

/** Sets the journal's community [R19] as the first version's review, so the editor's button
 *  submits it there. A later version stays in its first version's communities. */
async function requestCommunity(
  api: ZenodoApi,
  rec: ZenodoRecord,
  slug: string | undefined,
): Promise<void> {
  if (!slug) return;
  const id = await api.communityId(slug);
  if ((rec.parent?.communities?.ids ?? []).includes(id)) return;
  if ((rec.versions?.index ?? 1) > 1) {
    process.stderr.write(
      `[warn] the record is not in the Zenodo community "${slug}", which Zenodo takes only ` +
        `on a first version; an editor can submit the published record to it on Zenodo.\n`,
    );
    return;
  }
  if (rec.parent?.review?.receiver?.community === id) return;
  await api.setCommunityReview(String(rec.id), id);
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

/** Zenodo's name parts for an author name as MyST parses it. Zenodo has no field for a suffix,
 *  so it goes with the family name. */
function personName(n: Name = {}): { family_name: string; given_name?: string } {
  const family = [n.non_dropping_particle, n.family, n.suffix].filter(Boolean).join(' ');
  const given = [n.given, n.dropping_particle].filter(Boolean).join(' ');
  if (family) return given ? { given_name: given, family_name: family } : { family_name: family };
  return { family_name: given || n.literal || '' };
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

const related = (identifier: string, relation: string, scheme: string) => ({
  identifier,
  relation_type: { id: relation },
  scheme,
});

/**
 * Builds the draft from a myst project and the journal's `zenodo:` settings. The description is
 * HTML paragraphs (abstract, journal paragraph, extra part, links), the identity URN sits beside
 * the GitHub URL [R7], and the GitHub URL is also the code repository field. The community is
 * the draft's review, set by {@link requestCommunity}.
 */
export function buildDraft(input: MetadataInput): DraftBody {
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

  // MyST reads the authors as it does for its own output: names parsed, affiliations as ids.
  const fm = validateProjectFrontmatter(project, { property: 'project', messages: {} });
  const affiliationName = new Map((fm.affiliations ?? []).map((a) => [a.id, a.name]));
  const creators: Array<Record<string, unknown>> = [];
  for (const a of fm.authors ?? []) {
    const person: Record<string, unknown> = { type: 'personal', ...personName(a.nameParsed) };
    const orcid = a.orcid ?? '';
    // Zenodo replaces the name from the ORCID profile when the ORCID does not resolve, so invalid
    // and placeholder ORCIDs (the template's 0000-0000-...) are dropped.
    if (orcid && ORCID_RE.test(orcid) && !orcid.startsWith('0000-0000-')) {
      person.identifiers = [{ scheme: 'orcid', identifier: orcid }];
    } else if (orcid) {
      const who = [person.given_name, person.family_name].filter(Boolean).join(' ');
      process.stderr.write(`[warn] skipping invalid/placeholder ORCID for ${who}: ${orcid}\n`);
    }
    const c: Record<string, unknown> = { person_or_org: person };
    const affs = (a.affiliations ?? []).map((id) => affiliationName.get(id)).filter(Boolean);
    if (affs.length) c.affiliations = affs.map((name) => ({ name }));
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
  if (siteUrl) {
    const href = escapeHtml(siteUrl);
    desc.push(`<p>Project Website: <a href="${href}">${href}</a></p>`);
  }
  desc.push(`<p>Repository: <a href="${githubUrl}">${githubUrl}</a></p>`);
  const venue = project.venue;
  if (venue) {
    const v = typeof venue === 'string' ? venue : (venue.title ?? String(venue));
    desc.push(`<p>Venue: ${v}</p>`);
  }
  if (project.funding) desc.push(`<p>Funding: ${project.funding}</p>`);

  const relatedIds = [related(githubUrl, 'isversionof', 'url')];
  // The identity URN [R7], which survives a repo move.
  if (paperId) relatedIds.push(related(paperUrn(paperId), 'isversionof', 'urn'));
  if (siteUrl) relatedIds.push(related(siteUrl, 'isidenticalto', 'url'));
  if (yt) relatedIds.push(related(yt, 'issupplementedby', 'url'));

  const md: Record<string, unknown> = {
    resource_type: { id: 'publication-article' },
    title: String(project.title),
    creators,
    description: desc.join(''),
    rights: [{ id: licenseId }],
    related_identifiers: relatedIds,
    // Zenodo needs a publisher to register the DOI.
    publisher: 'Zenodo',
  };
  if (keywords.length) md.subjects = keywords.map((subject: string) => ({ subject }));
  if (version !== undefined) md.version = version;
  const pubdate = publicationDate ?? project.date;
  if (pubdate) md.publication_date = String(pubdate);
  return {
    metadata: md,
    custom_fields: { 'code:codeRepository': githubUrl },
    access: { record: 'public', files: 'public' },
    files: { enabled: true },
  };
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
  /** The journal the PDF was built from: what `journal.zip` holds, the paper's own repo and
   *  commit when it is its own journal, null without one. */
  journal_repo: string | null;
  journal_commit: string | null;
  built_at: string;
  // What it takes to render the deposit again [R66]: engine.zip carries everything but
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
 * bundling rule covers all three [R76].
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
 * template is inside oak's checkout, already archived as `engine.zip`.
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

/* --------------------------------------------------------------------------
 * The journal the build used, archived into the deposit [R66]
 * ------------------------------------------------------------------------ */

export class JournalArchiveError extends Error {}

/** The journal the provenance names, and the checkout `journal.zip` is archived from. */
export interface JournalArchive {
  /** null when the paper repo is its own journal, so `source.zip` holds it. */
  root: string | null;
  repo: string | null;
  commit: string;
}

/**
 * The journal commit this deposit records, read from the stamp the build left in
 * `myst.oak.yml`: the journal is fetched at its default branch on every run, so the deposit's
 * checkout can be at a later commit than the build's, and the commit is fetched into it. `paper`
 * when the paper repo is its own journal; null when built with `--no-instance`. Run before
 * anything is written to Zenodo [R101].
 *
 * Throws {@link JournalArchiveError} when the build used a journal this deposit cannot archive.
 */
export async function prepareJournalArchive(
  repoRoot: string,
  instanceRoot: string | null,
  git: GitContext,
  paper: { repo: string; commit: string },
): Promise<JournalArchive | null> {
  const stamp = readJournalStamp(repoRoot);
  if (stamp === undefined) {
    if (instanceRoot === null) return null;
    throw new JournalArchiveError(msg.workflow.depositJournalUnstamped);
  }
  if (stamp === null) return null;
  if (!('commit' in stamp)) return { root: null, ...paper }; // repo: "."
  if (stamp.commit === null) throw new JournalArchiveError(msg.workflow.depositJournalUncommitted);
  const at = stamp.repo ? `${stamp.repo}@${stamp.commit}` : stamp.commit;
  if (instanceRoot === null) {
    throw new JournalArchiveError(msg.workflow.depositJournalNotGiven(at));
  }
  const origin = await git.originRepo(instanceRoot);
  if (stamp.repo && origin && !sameRepo(stamp.repo, origin)) {
    throw new JournalArchiveError(msg.workflow.depositJournalOtherRepo(stamp.repo, origin));
  }
  try {
    await git.fetchCommit(instanceRoot, stamp.commit);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new JournalArchiveError(msg.workflow.depositJournalUnfetchable(at, why));
  }
  return { root: instanceRoot, repo: origin ?? stamp.repo, commit: stamp.commit };
}

/**
 * What can make a deposit impossible, in one place so a caller can check before writing to
 * Zenodo [R101]. `oak validate` reports the same clash on the pull request
 * ({@link depositCollisions}). The journal's own check is {@link prepareJournalArchive}, which
 * needs git.
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
 * Assembles the deposit: oak's fixed files plus every file in the paper's `deposit/` folder, as
 * they are [R28]; a clash with a fixed name is an error. Returns the paths, sorted.
 *
 * `engine.zip` is a `git archive` of oak at its pinned release [R66], which carries
 * `bin/typst`, `dist/cli.cjs` and `templates/typst/`: everything but node needed to render the
 * PDF again, on linux x86_64. `journal.zip` is a `git archive` of `journal`, the journal commit
 * the build used, unless `source.zip` holds it ({@link prepareJournalArchive}). `template.zip` holds a template that is not
 * oak's own [R76]; see {@link templateArchiveDir}. `myst.oak.yml` records what the build
 * resolved; its paths are the build machine's.
 */
export async function buildBundle(
  out: string,
  pdf: string,
  repoRoot: string,
  engineRoot: string,
  provenance: BundleProvenance,
  git: GitContext,
  journal: JournalArchive | null = null,
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
  for (const name of ['myst.yml', DERIVED_CONFIG_FILE]) {
    const src = join(repoRoot, name);
    if (existsSync(src)) copyFileSync(src, join(out, name));
  }
  if (journal?.root) {
    await git.gitArchive(journal.root, resolve(join(out, JOURNAL_BUNDLE_NAME)), journal.commit);
  }
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

/** What `engine.zip` must carry to render the PDF again [R66]. Both are committed only at
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
 *  build with no journal, gets empty defaults. A journal.yml oak cannot read throws, so a
 *  deposit never goes out without the journal's settings. */
export function loadJournalZenodo(instanceRoot: string | null): ZenodoConfig {
  const journal = instanceRoot ? readJournalConfig(instanceRoot) : null;
  return (journal ?? JournalConfig.parse({ name: 'x' })).zenodo;
}

/**
 * The paper's website for the deposit's Project Website link: the `site_url` of the paper's entry
 * in the journal's `registry/papers.yml`, else its GitHub Pages URL ({@link pagesUrl}), which is
 * the rule `paperUrls` in `plugins/gallery.mjs` follows. Undefined without a repo.
 */
export function defaultSiteUrl(
  repo: string | null,
  instanceRoot: string | null,
): string | undefined {
  if (!repo) return undefined;
  const path = instanceRoot ? join(instanceRoot, 'registry', 'papers.yml') : null;
  const entries = path && existsSync(path) ? readRegistry(readDoc(path).toJS())?.entries : null;
  const own = (entries ?? []).find((e) => {
    const entryRepo = locationRepo(e.location);
    return !!e.site_url && !!entryRepo && sameRepo(entryRepo, repo);
  });
  return own?.site_url ?? pagesUrl(repo);
}

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
  /** The Project Website link; {@link defaultSiteUrl} when absent, none when empty. */
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
  const { mystPath, repo, api, instanceRoot } = input;
  const siteUrl = input.siteUrl ?? defaultSiteUrl(repo, instanceRoot);
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
  const zenodo = loadJournalZenodo(instanceRoot);
  const body = buildDraft({
    project: projectOf(doc2),
    paperId: project.id ? String(project.id) : undefined,
    githubUrl,
    siteUrl,
    zenodo,
    abstractParas: abstractParagraphs(repoRoot),
    extraDescParas: zenodoExtraParagraphs(repoRoot),
  });

  const existing = await api.findDeposit({
    paperId: project.id ? String(project.id) : undefined,
    githubUrl,
  });
  let rec: ZenodoRecord;
  // A first version never published is a draft to reuse; anything else has a concept DOI.
  if (existing && existing.is_published === false && (existing.versions?.index ?? 1) === 1) {
    process.stderr.write(`[prepare] reusing draft ${existing.id}\n`);
    rec = await api.updateDraft(String(existing.id), body);
  } else if (existing) {
    return err(
      3,
      `Published deposit already exists (${conceptDoiFor(existing, sandbox)}); refusing to ` +
        `create a parallel concept. Add that DOI to myst.yml manually.`,
    );
  } else {
    rec = await api.createDraft(body);
  }
  if (!rec.pids?.doi) rec = await api.reserveDoi(String(rec.id));

  const cdoi = conceptDoiFor(rec, sandbox);
  const draftUrl = rec.links?.self_html;

  doc2.setIn(['project', 'doi'], cdoi);
  doc2.setIn(['project', 'github'], githubUrl);
  writeDoc(mystPath, doc2);

  return ok({
    concept_doi: cdoi,
    draft_url: draftUrl,
    deposition_id: Number(rec.id),
    site_url: siteUrl,
  });
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
  const { mystPath, pdf, tag, bundleOut, api, git, instanceRoot, engineRoot } = input;
  const sandbox = api.sandbox;
  const doc = readDoc(mystPath);
  const project = projectOf(doc);

  const conceptDoi: string | undefined = project.doi;
  if (!conceptDoi)
    return err(2, 'project.doi missing; run prepare and merge that PR before tagging.');
  const parsed = parseZenodoDoi(conceptDoi);
  if (!parsed) return err(2, msg.workflow.notZenodoDoi(conceptDoi));
  if (parsed.sandbox !== sandbox) {
    return err(2, `DOI prefix says sandbox=${parsed.sandbox} but --sandbox=${sandbox}.`);
  }
  if (!PAPER_VERSION_TAG.test(tag)) return err(2, `tag must match vMAJOR.MINOR.PATCH (got ${tag})`);
  const version = tag.slice(1);

  if (!existsSync(pdf)) return err(2, `--pdf not found: ${pdf}`);

  const githubUrl: string | undefined = project.github;
  if (!githubUrl) return err(2, 'project.github missing; should have been set by prepare.');
  const repo = repoFromGithubUrl(githubUrl);
  if (!repo) return err(2, msg.workflow.depositBadGithubUrl(mystPath, githubUrl));
  const siteUrl = input.siteUrl ?? defaultSiteUrl(repo, instanceRoot);

  const repoRoot = resolve(mystPath, '..');

  const sha = await git.headSha(repoRoot);

  // Checked before anything is written to Zenodo, and reported in the result [R101].
  let journal: JournalArchive | null;
  try {
    assertBundlePreconditions(repoRoot, engineRoot);
    journal = await prepareJournalArchive(repoRoot, instanceRoot, git, { repo, commit: sha });
  } catch (e) {
    if (
      e instanceof BundleCollisionError ||
      e instanceof TemplateArchiveError ||
      e instanceof JournalArchiveError
    ) {
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

  let rec = await api.latestVersion(conceptDoi);
  if (rec === null) {
    return err(2, `No Zenodo record matches ${conceptDoi} (token mismatch? deleted draft?)`);
  }

  const expectedConcept = `${zenodoDoiPrefix(sandbox)}${rec.parent?.id}`;
  if (conceptDoi !== expectedConcept) {
    return err(
      2,
      `Concept DOI sanity check failed: myst.yml has ${conceptDoi}, Zenodo's parent id implies ${expectedConcept}`,
    );
  }

  if (rec.is_published) {
    // The CI token lacks `deposit:actions`, which a new version needs, so an editor clicks "New
    // version" on Zenodo to create the empty draft.
    const recordUrl = rec.links?.record_html ?? rec.links?.self_html;
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
  process.stderr.write(`[publish] reusing existing draft ${rec.id}\n`);
  const id = String(rec.id);

  const zenodo = loadJournalZenodo(instanceRoot);
  rec = await api.updateDraft(
    id,
    buildDraft({
      project,
      paperId: project.id ? String(project.id) : undefined,
      githubUrl,
      siteUrl,
      zenodo,
      version,
      publicationDate: String(project.date ?? new Date().toISOString().slice(0, 10)),
      abstractParas: abstractParagraphs(repoRoot),
      extraDescParas: zenodoExtraParagraphs(repoRoot),
    }),
  );
  await requestCommunity(api, rec, zenodo.community);

  const versionDoi = versionDoiFor(rec, sandbox);
  const provenance: BundleProvenance = {
    repo,
    commit_sha: sha,
    tag,
    site_url: siteUrl,
    concept_doi: conceptDoi,
    version_doi: versionDoi,
    review_pr: await git.reviewPr(repoRoot, sha),
    journal_repo: journal?.repo ?? null,
    journal_commit: journal?.commit ?? null,
    built_at: new Date().toISOString(),
    platform: 'linux-x86_64',
    typst_version: readTypstVersion(engineRoot),
  };
  let files: string[];
  try {
    files = await buildBundle(bundleOut, pdf, repoRoot, engineRoot, provenance, git, journal);
  } catch (e) {
    if (e instanceof EngineArchiveError) return err(2, e.message);
    throw e;
  }

  await api.clearDraftFiles(id);
  for (const p of files) {
    process.stderr.write(`[publish] upload ${basename(p)}\n`);
    await api.uploadFile(id, basename(p), readFileSync(p));
  }

  return ok({
    version_doi: versionDoi,
    draft_url: rec.links?.self_html,
    deposition_id: Number(rec.id),
    bundle_dir: bundleOut,
    site_url: siteUrl,
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
  const { mystPath, api, instanceRoot } = input;
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

  const rec = await api.latestVersion(conceptDoi);
  if (rec === null) {
    out.state = 'no record matches';
    return { exitCode: 0, result: out };
  }
  out.latest_deposition_id = Number(rec.id);
  out.submitted = rec.is_published ?? false;
  out.draft_url = rec.links?.self_html;
  out.latest_version = rec.metadata?.version;
  out.latest_doi = rec.pids?.doi?.identifier;

  const repoRoot = resolve(mystPath, '..');
  const preview = buildDraft({
    project,
    paperId: project.id ? String(project.id) : undefined,
    githubUrl: project.github ?? '',
    siteUrl: input.siteUrl ?? defaultSiteUrl(repoFromGithubUrl(project.github ?? ''), instanceRoot),
    zenodo: loadJournalZenodo(instanceRoot),
    abstractParas: abstractParagraphs(repoRoot),
    extraDescParas: zenodoExtraParagraphs(repoRoot),
  });
  out.metadata_preview_keys = Object.keys(preview.metadata).sort();
  out.creator_count = (preview.metadata.creators as unknown[]).length;
  out.description_preview = preview.metadata.description;
  return { exitCode: 0, result: out };
}
