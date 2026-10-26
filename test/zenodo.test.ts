/**
 * The deposit logic, with a fake transport (no network) answering as Zenodo's InvenioRDM API
 * does, and a fake git context (no git or gh): pagination past 100 [R20] [R35], finding a
 * deposit by the paper's id first [R7], the journal's metadata and community from journal.yml
 * [R19], the authors, the `deposit/` folder and its reserved names [R28], and prepare and
 * publish, including moving from sandbox to production [R29].
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { parseDocument } from 'yaml';
import {
  ZenodoApi,
  buildDraft,
  personName,
  buildBundle,
  paperUrn,
  cmdPrepare,
  cmdPublish,
  defaultSiteUrl,
  BundleCollisionError,
  assertBundlePreconditions,
  TemplateArchiveError,
  RESERVED_BUNDLE_NAMES,
  EngineArchiveError,
  ZENODO_PROD,
  ZENODO_SANDBOX,
  readStampedTemplate,
  resolveTemplateDir,
  type ZenodoTransport,
  type TransportResponse,
  type GitContext,
  type ZenodoRecord,
} from '../src/zenodo.js';

/* --------------------------------------------------------------------------
 * Fakes
 * ------------------------------------------------------------------------ */

interface Recorded {
  method: string;
  url: string;
  opts: Parameters<ZenodoTransport['request']>[2];
}

/** A fake transport driven by a handler; records every call. */
function fakeTransport(handler: (r: Recorded) => { status?: number; json: unknown }): {
  transport: ZenodoTransport;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const transport: ZenodoTransport = {
    async request(method, url, opts): Promise<TransportResponse> {
      const rec = { method, url, opts };
      calls.push(rec);
      const { status = 200, json } = handler(rec);
      const text = JSON.stringify(json);
      return { ok: status >= 200 && status < 300, status, text, json: () => json };
    },
  };
  return { transport, calls };
}

const fakeGit: GitContext = {
  async headSha() {
    return 'deadbeef';
  },
  async gitArchive(_root, outZip) {
    // A real zip with what a release of oak commits, so `engine.zip` reads as one.
    const zip = new AdmZip();
    zip.addFile('dist/cli.cjs', Buffer.from('// bundle'));
    zip.addFile('bin/typst', Buffer.from('typst'));
    zip.writeZip(outZip);
  },
  async reviewPr() {
    return '42';
  },
  async fetchCommit() {},
  async originRepo() {
    return null;
  },
};

/** A first-version draft as `/api/records/<id>/draft` returns it. */
const rec = (over: Partial<ZenodoRecord> = {}): ZenodoRecord => ({
  id: '1',
  parent: { id: '1', communities: {} },
  is_published: false,
  is_draft: true,
  versions: { index: 1 },
  links: { self_html: 'https://sandbox.zenodo.org/uploads/1' },
  metadata: {},
  ...over,
});

/** A search page from `/api/user/records`. */
const hits = (items: ZenodoRecord[]) => ({ hits: { hits: items, total: items.length } });

const pathOf = (url: string) => new URL(url).pathname;

/**
 * A fake Zenodo holding `draft` (id 5 unless given), routed by method and path. Records every
 * call, the draft bodies written, the files uploaded, and the provenance sent.
 */
function fakeZenodo(
  draft: ZenodoRecord = rec({ id: '5', parent: { id: '5' } }),
  files: string[] = [],
) {
  const id = String(draft.id);
  const uploaded: string[] = [];
  const deleted: string[] = [];
  const bodies: Array<Record<string, any>> = [];
  const provenance: Array<Record<string, unknown>> = [];
  const { transport, calls } = fakeTransport((r) => {
    const path = pathOf(r.url);
    const file = /\/draft\/files\/([^/]+)(\/content|\/commit)?$/.exec(path);
    if (r.method === 'GET' && path === '/api/user/records') return { json: hits([draft]) };
    if (r.method === 'GET' && path === `/api/records/${id}/draft/files`)
      return { json: { entries: files.map((key) => ({ key })) } };
    if (r.method === 'GET' && path.startsWith(`/api/records/${id}`)) return { json: draft };
    if (r.method === 'PUT' && path === `/api/records/${id}/draft`) {
      bodies.push(r.opts.json as Record<string, any>);
      return { json: draft };
    }
    if (r.method === 'PUT' && file?.[2] === '/content') {
      const name = decodeURIComponent(file[1]!);
      uploaded.push(name);
      if (name === 'publication-provenance.json') {
        provenance.push(JSON.parse(Buffer.from(r.opts.body!).toString('utf8')));
      }
      return { json: {} };
    }
    if (r.method === 'DELETE' && file) {
      deleted.push(decodeURIComponent(file[1]!));
      return { status: 204, json: null };
    }
    return { json: {} };
  });
  const api = new ZenodoApi(transport, true, 't');
  return { api, calls, uploaded, deleted, bodies, provenance };
}

/* --------------------------------------------------------------------------
 * Pagination: [R20]/[R35.1]
 * ------------------------------------------------------------------------ */

describe('searchMyRecords pagination', () => {
  it('walks pages until a short page (past the 100 cap)', async () => {
    // 250 records: full pages of 100, 100, then a short 50 → three requests.
    const all = Array.from({ length: 250 }, (_, i) => rec({ id: String(i + 1) }));
    const { transport, calls } = fakeTransport(({ opts }) => {
      const page = Number(opts.params?.page);
      const size = Number(opts.params?.size);
      return { json: hits(all.slice((page - 1) * size, page * size)) };
    });
    const api = new ZenodoApi(transport, true, 't');
    const got = await api.searchMyRecords();
    expect(got.length).toBe(250);
    expect(calls.length).toBe(3);
    expect(pathOf(calls[0]!.url)).toBe('/api/user/records');
    expect(calls[0]!.opts.params).toMatchObject({ size: 100, page: 1 });
    // Zenodo answers in its legacy shape unless asked for the InvenioRDM one.
    expect(calls[0]!.opts.headers?.Accept).toBe('application/vnd.inveniordm.v1+json');
  });
});

/* --------------------------------------------------------------------------
 * Finding a deposit: by id first, then by the GitHub repo [R7]
 * ------------------------------------------------------------------------ */

describe('findDeposit', () => {
  const id = 'fixture-2026-sample-paper';
  const gh = 'https://github.com/o/r';
  const match = rec({
    id: '7',
    metadata: {
      related_identifiers: [
        { identifier: paperUrn(id), relation_type: { id: 'isversionof' }, scheme: 'urn' },
      ],
    },
  });

  it('matches by id URN first (query keyed on the urn)', async () => {
    const { transport, calls } = fakeTransport(({ opts }) => {
      const q = String(opts.params?.q ?? '');
      return { json: hits(q.includes(paperUrn(id)) ? [match] : []) };
    });
    const api = new ZenodoApi(transport, true, 't');
    const found = await api.findDeposit({ paperId: id, githubUrl: gh });
    expect(found?.id).toBe('7');
    // The first query is the id URN, before the GitHub one.
    expect(calls[0]!.opts.params?.q).toBe(
      `metadata.related_identifiers.identifier:"${paperUrn(id)}"`,
    );
  });

  it('falls back to the GitHub URL when the id finds nothing', async () => {
    const byUrl = rec({ id: '9', metadata: { related_identifiers: [{ identifier: gh }] } });
    const { transport } = fakeTransport(({ opts }) => {
      const q = String(opts.params?.q ?? '');
      return { json: hits(q.includes(gh) ? [byUrl] : []) };
    });
    const api = new ZenodoApi(transport, true, 't');
    const found = await api.findDeposit({ paperId: id, githubUrl: gh });
    expect(found?.id).toBe('9');
  });

  it('does a full scan only when both targeted queries are empty', async () => {
    const buried = rec({ id: '11', metadata: { related_identifiers: [{ identifier: gh }] } });
    let unfilteredCalls = 0;
    const { transport } = fakeTransport(({ opts }) => {
      if (opts.params?.q === undefined) {
        unfilteredCalls++;
        return { json: hits([buried]) };
      }
      return { json: hits([]) }; // targeted queries find nothing (e.g. the search index lags)
    });
    const api = new ZenodoApi(transport, true, 't');
    const found = await api.findDeposit({ paperId: id, githubUrl: gh });
    expect(found?.id).toBe('11');
    expect(unfilteredCalls).toBe(1);
  });
});

/* --------------------------------------------------------------------------
 * Metadata: the journal's text from journal.yml [R19], and the id [R7]
 * ------------------------------------------------------------------------ */

describe('buildDraft', () => {
  const project = {
    id: 'fixture-2026-sample-paper',
    title: 'A Paper',
    license: 'CC-BY-4.0',
    keywords: ['a', 'b'],
    authors: [
      { name: 'Ada', affiliations: ['Inst'], orcid: '0000-0002-1825-0097' },
      { name: 'Placeholder', orcid: '0000-0000-0000-0000' },
    ],
  };

  it('leaves out the blurb for a new journal, and keeps the GitHub and id related identifiers', () => {
    const { metadata: md } = buildDraft({
      project,
      paperId: project.id,
      githubUrl: 'https://github.com/o/r',
      zenodo: {},
    });
    // Without a journal blurb the description is only the repo and site lines.
    expect(md.description).not.toContain('Program');
    const related = md.related_identifiers as Array<Record<string, any>>;
    expect(related).toContainEqual({
      identifier: paperUrn(project.id),
      relation_type: { id: 'isversionof' },
      scheme: 'urn',
    });
    expect(related.map((r) => r.identifier)).toContain('https://github.com/o/r');
  });

  it("adds the journal's blurb when journal.yml sets it, and no community field", () => {
    const draft = buildDraft({
      project,
      paperId: project.id,
      githubUrl: 'https://github.com/o/r',
      zenodo: { community: 'neuromatch', description_blurb: 'Made by the Fixture Journal.' },
    });
    expect(draft.metadata.description).toContain('Made by the Fixture Journal.');
    // The community is the draft's review, not a metadata field.
    expect(JSON.stringify(draft)).not.toContain('neuromatch');
  });

  it('writes the InvenioRDM fields: type, rights, subjects, publisher, code repository', () => {
    const draft = buildDraft({ project, githubUrl: 'https://github.com/o/r', zenodo: {} });
    expect(draft.metadata).toMatchObject({
      resource_type: { id: 'publication-article' },
      rights: [{ id: 'cc-by-4.0' }],
      subjects: [{ subject: 'a' }, { subject: 'b' }],
      publisher: 'Zenodo',
    });
    expect(draft.custom_fields).toEqual({ 'code:codeRepository': 'https://github.com/o/r' });
    expect(draft.access).toEqual({ record: 'public', files: 'public' });
  });

  it('drops placeholder or invalid ORCIDs and keeps valid ones', () => {
    const { metadata } = buildDraft({ project, githubUrl: 'https://github.com/o/r', zenodo: {} });
    const creators = metadata.creators as Array<Record<string, any>>;
    expect(creators[0]!.person_or_org.identifiers).toEqual([
      { scheme: 'orcid', identifier: '0000-0002-1825-0097' },
    ]);
    expect(creators[1]!.person_or_org.identifiers).toBeUndefined();
  });

  it('sends every affiliation, as a string, an object with a name, or a project affiliation id', () => {
    const { metadata } = buildDraft({
      project: {
        title: 'T',
        affiliations: [{ id: 'brown', name: 'Brown University' }],
        authors: [
          { name: 'Ada', affiliations: ['Inst A', { name: 'Inst B' }, 'brown'] },
          { name: 'Bo', affiliation: 'Solo Inst' },
          { name: 'Cy' },
        ],
      },
      githubUrl: 'https://github.com/o/r',
      zenodo: {},
    });
    const creators = metadata.creators as Array<Record<string, any>>;
    expect(creators[0]!.affiliations).toEqual([
      { name: 'Inst A' },
      { name: 'Inst B' },
      { name: 'Brown University' },
    ]);
    expect(creators[1]!.affiliations).toEqual([{ name: 'Solo Inst' }]);
    expect(creators[2]!.affiliations).toBeUndefined();
  });

  it('sends given and family names from the object form, and a string name whole', () => {
    const { metadata } = buildDraft({
      project: {
        title: 'T',
        authors: [{ name: { given: 'Ada', family: 'Lovelace' } }, { name: 'Josiah Carberry' }],
      },
      githubUrl: 'https://github.com/o/r',
      zenodo: {},
    });
    const people = (metadata.creators as Array<Record<string, any>>).map((c) => c.person_or_org);
    expect(people[0]).toEqual({ type: 'personal', given_name: 'Ada', family_name: 'Lovelace' });
    expect(people[1]).toEqual({ type: 'personal', family_name: 'Josiah Carberry' });
  });

  it('takes an author written as plain text as its name', () => {
    const { metadata } = buildDraft({
      project: { title: 'T', authors: ['Paolo Marzolo'] },
      githubUrl: 'https://github.com/o/r',
      zenodo: {},
    });
    const creators = metadata.creators as Array<Record<string, any>>;
    expect(creators).toEqual([
      { person_or_org: { type: 'personal', family_name: 'Paolo Marzolo' } },
    ]);
  });
});

describe('personName', () => {
  it("takes MyST's aliases and particles", () => {
    expect(personName({ first: 'Vincent', particle: 'van', surname: 'Gogh' })).toEqual({
      given_name: 'Vincent',
      family_name: 'van Gogh',
    });
    expect(
      personName({ forename: 'Ludwig', 'dropping-particle': 'van', last: 'Beethoven' }),
    ).toEqual({ given_name: 'Ludwig van', family_name: 'Beethoven' });
  });

  it('keeps a name it cannot split whole', () => {
    expect(personName({ literal: 'Grace Hopper' })).toEqual({ family_name: 'Grace Hopper' });
    expect(personName({ given: 'Madonna' })).toEqual({ family_name: 'Madonna' });
    expect(personName('Grace Brewster Murray Hopper')).toEqual({
      family_name: 'Grace Brewster Murray Hopper',
    });
  });
});

/* --------------------------------------------------------------------------
 * Bundle: the deposit/ folder and its reserved names [R28]
 * ------------------------------------------------------------------------ */

describe('buildBundle', () => {
  function paperWithDeposit(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'oak-bundle-'));
    writeFileSync(join(root, 'myst.yml'), 'project: {}');
    writeFileSync(join(root, 'paper.pdf'), '%PDF-fake');
    const dd = join(root, 'deposit');
    mkdirSync(dd);
    for (const [n, c] of Object.entries(files)) writeFileSync(join(dd, n), c);
    return root;
  }
  const prov = {
    repo: 'o/r',
    commit_sha: 'x',
    tag: 'v1.0.0',
    site_url: undefined,
    concept_doi: 'd',
    version_doi: 'v',
    review_pr: '42',
    journal_repo: null,
    journal_commit: null,
    built_at: 'now',
    platform: 'linux-x86_64',
    typst_version: '0.14.2',
  };

  it('adds the fixed files (incl. engine.zip) plus deposit/ files verbatim', async () => {
    const root = paperWithDeposit({ 'data.csv': '1,2,3', 'extra.txt': 'hi' });
    const out = join(root, '_bundle');
    const files = (await buildBundle(out, join(root, 'paper.pdf'), root, root, prov, fakeGit)).map(
      (p) => p.split('/').pop(),
    );
    expect(files).toEqual(
      [
        'data.csv',
        'engine.zip',
        'extra.txt',
        'myst.yml',
        'paper.pdf',
        'publication-provenance.json',
        'source.zip',
      ].sort(),
    );
    const written = JSON.parse(readFileSync(join(out, 'publication-provenance.json'), 'utf8'));
    expect(written.review_pr).toBe('42');
  });

  it('rejects a deposit/ file that collides with an engine-reserved name', async () => {
    const root = paperWithDeposit({ 'paper.pdf': 'oops' });
    await expect(
      buildBundle(join(root, '_bundle'), join(root, 'paper.pdf'), root, root, prov, fakeGit),
    ).rejects.toBeInstanceOf(BundleCollisionError);
  });

  it('reserves template.zip against deposit/ collisions too', async () => {
    const root = paperWithDeposit({ 'template.zip': 'oops' });
    await expect(
      buildBundle(join(root, '_bundle'), join(root, 'paper.pdf'), root, root, prov, fakeGit),
    ).rejects.toBeInstanceOf(BundleCollisionError);
  });

  /* ---- the template the PDF was rendered with [R76] [R66] --------------- */

  /** A paper root beside a separate oak checkout, so whether a template is already inside
   *  engine.zip depends on the template, not on the test layout. */
  function paperAndEngine(): { paper: string; engine: string; tmp: string } {
    const tmp = mkdtempSync(join(tmpdir(), 'oak-tmpl-'));
    const paper = join(tmp, 'paper');
    const engine = join(tmp, 'engine');
    mkdirSync(paper);
    mkdirSync(join(engine, 'templates', 'typst'), { recursive: true });
    writeFileSync(join(engine, 'templates', 'typst', 'template.yml'), 'kind: typst');
    writeFileSync(join(paper, 'paper.pdf'), '%PDF-fake');
    writeFileSync(join(paper, 'myst.yml'), 'project: {}');
    return { paper, engine, tmp };
  }
  /** What `oak build` leaves behind: `myst.oak.yml`, with the template compose resolved. */
  function stamp(paper: string, template: string): void {
    writeFileSync(
      join(paper, 'myst.oak.yml'),
      `project:\n  exports:\n  - id: typst-pdf\n    format: typst\n    template: ${template}\n`,
    );
  }
  const namesIn = (files: string[]) => files.map((p) => p.split('/').pop());

  it("adds no template.zip when the template is in oak's checkout", async () => {
    const { paper, engine } = paperAndEngine();
    stamp(paper, join(engine, 'templates', 'typst'));

    const files = await buildBundle(
      join(paper, '_bundle'),
      join(paper, 'paper.pdf'),
      paper,
      engine,
      prov,
      fakeGit,
    );
    expect(namesIn(files)).not.toContain('template.zip');
    expect(namesIn(files)).toEqual(RESERVED_BUNDLE_NAMES.slice().sort());
  });

  it("archives a journal's or author's local template as template.zip", async () => {
    const { paper, engine, tmp } = paperAndEngine();
    const journalTemplate = join(tmp, 'instance', 'typst-template');
    mkdirSync(journalTemplate, { recursive: true });
    writeFileSync(join(journalTemplate, 'template.yml'), 'kind: typst');
    writeFileSync(join(journalTemplate, 'template.typ'), '#let x = 1');
    stamp(paper, journalTemplate);

    const out = join(paper, '_bundle');
    const files = await buildBundle(out, join(paper, 'paper.pdf'), paper, engine, prov, fakeGit);
    expect(namesIn(files)).toContain('template.zip');
    const entries = new AdmZip(join(out, 'template.zip')).getEntries().map((e) => e.entryName);
    expect(entries).toEqual(expect.arrayContaining(['template.yml', 'template.typ']));
  });

  it("archives an author's relative template, resolved against the paper root", async () => {
    // myst resolves an author's `./my-template` against the paper root, while the deposit runs
    // from wherever `oak` was started, so the path is resolved against the paper root.
    const { paper, engine } = paperAndEngine();
    mkdirSync(join(paper, 'my-template'));
    writeFileSync(join(paper, 'my-template', 'template.yml'), 'kind: typst');
    stamp(paper, './my-template');

    const out = join(paper, '_bundle');
    const files = await buildBundle(out, join(paper, 'paper.pdf'), paper, engine, prov, fakeGit);
    expect(namesIn(files)).toContain('template.zip');
    expect(new AdmZip(join(out, 'template.zip')).getEntries().map((e) => e.entryName)).toContain(
      'template.yml',
    );
  });

  it('archives a remote template from where myst downloaded it', async () => {
    const { paper, engine } = paperAndEngine();
    const url = 'https://github.com/o/r/releases/download/v1.2.3/typst-template.zip';
    const materialized = join(
      paper,
      '_build',
      'templates',
      'typst',
      createHash('sha256').update(url).digest('hex'),
    );
    mkdirSync(materialized, { recursive: true });
    writeFileSync(join(materialized, 'template.yml'), 'kind: typst');
    stamp(paper, url);

    const out = join(paper, '_bundle');
    const files = await buildBundle(out, join(paper, 'paper.pdf'), paper, engine, prov, fakeGit);
    expect(namesIn(files)).toContain('template.zip');
    expect(new AdmZip(join(out, 'template.zip')).getEntries().map((e) => e.entryName)).toContain(
      'template.yml',
    );
  });

  it("refuses to deposit when a template that is not oak's cannot be found", async () => {
    const { paper, engine } = paperAndEngine();
    stamp(paper, 'https://example.org/t.zip'); // never downloaded; nothing was built here

    // A published PDF that cannot be rendered again is worse than a failed deposit.
    await expect(
      buildBundle(join(paper, '_bundle'), join(paper, 'paper.pdf'), paper, engine, prov, fakeGit),
    ).rejects.toBeInstanceOf(TemplateArchiveError);
  });
});

describe('readStampedTemplate / resolveTemplateDir ([R76])', () => {
  it("reads the template the build used, from myst.oak.yml, not from the author's myst.yml", () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-stamp-'));
    writeFileSync(
      join(root, 'myst.yml'),
      'project:\n  exports:\n  - id: typst-pdf\n    format: typst\n    template: ./author\n',
    );
    writeFileSync(
      join(root, 'myst.oak.yml'),
      'project:\n  exports:\n  - id: typst-pdf\n    format: typst\n    template: /resolved/by/compose\n',
    );
    expect(readStampedTemplate(root)).toBe('/resolved/by/compose');
  });

  it('falls back to the author config when nothing was built here', () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-stamp-'));
    writeFileSync(
      join(root, 'myst.yml'),
      'project:\n  exports:\n  - id: typst-pdf\n    format: typst\n    template: ./author\n',
    );
    expect(readStampedTemplate(root)).toBe('./author');
  });

  it('is null when no typst export declares a template', () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-stamp-'));
    writeFileSync(
      join(root, 'myst.yml'),
      'project:\n  exports:\n  - id: typst-pdf\n    format: typst\n',
    );
    expect(readStampedTemplate(root)).toBeNull();
  });

  describe('resolveTemplateDir mirrors myst-templates resolveInputs', () => {
    const paper = '/paper';
    it('uses a local directory in place', () => {
      const dir = mkdtempSync(join(tmpdir(), 'oak-dir-'));
      writeFileSync(join(dir, 'template.yml'), 'kind: typst');
      expect(resolveTemplateDir(dir, paper)).toBe(dir);
    });

    it('is not shadowed by a same-named directory carrying no template.yml ([R107])', () => {
      // myst fetches `lapreprint-typst` from its registry when the local path is not a
      // template, so the local files are not what rendered the PDF.
      const root = mkdtempSync(join(tmpdir(), 'oak-shadow-'));
      mkdirSync(join(root, 'lapreprint-typst'));
      expect(resolveTemplateDir('lapreprint-typst', root)).toBe(
        join(root, '_build/templates/typst/myst/lapreprint-typst'),
      );
    });
    it('climbs to the directory when pointed at the template.yml', () => {
      const dir = mkdtempSync(join(tmpdir(), 'oak-dir-'));
      writeFileSync(join(dir, 'template.yml'), 'kind: typst');
      expect(resolveTemplateDir(join(dir, 'template.yml'), paper)).toBe(dir);
    });
    it('hashes a URL into _build/templates/typst/<sha256>', () => {
      const url = 'https://example.org/t.zip';
      expect(resolveTemplateDir(url, paper)).toBe(
        join(paper, '_build', 'templates', 'typst', createHash('sha256').update(url).digest('hex')),
      );
    });
    it('expands the three name shapes', () => {
      const t = (n: string) => resolveTemplateDir(n, paper);
      expect(t('lapreprint-typst')).toBe(
        join(paper, '_build/templates/typst/myst/lapreprint-typst'),
      );
      expect(t('acme/mine')).toBe(join(paper, '_build/templates/typst/acme/mine'));
      expect(t('typst/acme/mine')).toBe(join(paper, '_build/templates/typst/acme/mine'));
    });
  });
});

/* --------------------------------------------------------------------------
 * prepare and publish: the result, the myst.yml write, and sandbox to production [R29]
 * ------------------------------------------------------------------------ */

function paperRepo(mystBody: string): string {
  const root = mkdtempSync(join(tmpdir(), 'oak-prep-'));
  writeFileSync(join(root, 'myst.yml'), mystBody);
  return join(root, 'myst.yml');
}

/** The myst HTML build's output, which is where the deposit description's abstract comes from. */
function withBuild(mystPath: string, abstract = 'The abstract.'): void {
  const dir = join(mystPath.replace('myst.yml', ''), '_build', 'site', 'content');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({
      frontmatter: {
        parts: { abstract: { mdast: { children: [{ type: 'text', value: abstract }] } } },
      },
    }),
  );
}

const BARE_MYST = `project:
  id: fixture-2026-sample-paper
  title: A Paper
  authors:
  - name: Ada
`;

/**
 * A Zenodo where the account holds `existing` (none by default): `POST /api/records` creates
 * draft `id`, and reserving its DOI answers with it.
 */
function prepareZenodo(
  id: string,
  existing: ZenodoRecord[] = [],
  community?: { slug: string; id: string },
) {
  const created = rec({ id, parent: { id }, links: { self_html: `https://z/uploads/${id}` } });
  const reserved = { ...created, pids: { doi: { identifier: `10.5072/zenodo.${id}` } } };
  const { transport, calls } = fakeTransport((r) => {
    const path = pathOf(r.url);
    if (path === '/api/user/records') return { json: hits(existing) };
    if (r.method === 'POST' && path === '/api/records') return { json: created };
    if (r.method === 'PUT' && path.endsWith('/draft'))
      return { json: { ...existing[0], pids: {} } };
    if (path.endsWith('/draft/pids/doi')) return { json: reserved };
    if (community && path === `/api/communities/${community.slug}`)
      return { json: { id: community.id } };
    return { json: {} };
  });
  return { transport, calls };
}

/** A journal checkout whose journal.yml names `community`. */
function journalWithCommunity(community: string): string {
  const root = mkdtempSync(join(tmpdir(), 'oak-journal-'));
  writeFileSync(join(root, 'journal.yml'), `name: J\nzenodo:\n  community: ${community}\n`);
  return root;
}

describe('cmdPrepare', () => {
  it('creates a draft and stamps doi/github/date into the working-tree myst.yml ([R22])', async () => {
    const mystPath = paperRepo(BARE_MYST);
    const { transport, calls } = prepareZenodo('5');
    const api = new ZenodoApi(transport, true, 't');
    const out = await cmdPrepare({ mystPath, repo: 'o/r', api, instanceRoot: null });
    expect(out.exitCode).toBe(0);
    expect(out.result.status).toBe('ok');
    expect(out.result.concept_doi).toBe('10.5072/zenodo.5');

    const doc = parseDocument(readFileSync(mystPath, 'utf8'));
    expect(doc.getIn(['project', 'doi'])).toBe('10.5072/zenodo.5');
    expect(doc.getIn(['project', 'github'])).toBe('https://github.com/o/r');
    expect(doc.getIn(['project', 'date'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The draft carries the id URN, and its DOI is reserved.
    const post = calls.find((c) => c.method === 'POST' && pathOf(c.url) === '/api/records')!;
    const md = (post.opts.json as any).metadata;
    expect(md.related_identifiers.map((r: any) => r.identifier)).toContain(
      paperUrn('fixture-2026-sample-paper'),
    );
    expect(calls.map((c) => `${c.method} ${pathOf(c.url)}`)).toContain(
      'POST /api/records/5/draft/pids/doi',
    );
    expect(out.result.draft_url).toBe('https://z/uploads/5');
    expect(out.result.deposition_id).toBe(5);
  });

  it("reuses the paper's unpublished draft, and refuses a published one", async () => {
    const urn = { identifier: paperUrn('fixture-2026-sample-paper') };
    const draft = rec({ id: '6', parent: { id: '6' }, metadata: { related_identifiers: [urn] } });
    const { transport, calls } = prepareZenodo('6', [draft]);
    const out = await cmdPrepare({
      mystPath: paperRepo(BARE_MYST),
      repo: 'o/r',
      api: new ZenodoApi(transport, true, 't'),
      instanceRoot: null,
    });
    expect(out.exitCode).toBe(0);
    expect(out.result.concept_doi).toBe('10.5072/zenodo.6');
    expect(calls.some((c) => c.method === 'POST' && pathOf(c.url) === '/api/records')).toBe(false);
    expect(calls.some((c) => c.method === 'PUT' && pathOf(c.url) === '/api/records/6/draft')).toBe(
      true,
    );

    const published = { ...draft, is_published: true, is_draft: false };
    const refused = await cmdPrepare({
      mystPath: paperRepo(BARE_MYST),
      repo: 'o/r',
      api: new ZenodoApi(prepareZenodo('6', [published]).transport, true, 't'),
      instanceRoot: null,
    });
    expect(refused.exitCode).toBe(3);
    expect(refused.result.message).toContain('(10.5072/zenodo.6)');
  });

  it("puts the draft up for the journal's community, by the community's id ([R19])", async () => {
    const community = { slug: 'fixture-community', id: 'c0ffee' };
    const { transport, calls } = prepareZenodo('5', [], community);
    const out = await cmdPrepare({
      mystPath: paperRepo(BARE_MYST),
      repo: 'o/r',
      api: new ZenodoApi(transport, true, 't'),
      instanceRoot: journalWithCommunity(community.slug),
    });
    expect(out.exitCode).toBe(0);
    const review = calls.find((c) => pathOf(c.url) === '/api/records/5/draft/review')!;
    expect(review.method).toBe('PUT');
    expect(review.opts.json).toEqual({
      receiver: { community: 'c0ffee' },
      type: 'community-submission',
    });
  });

  it('refuses a same-env re-prepare but allows sandbox→prod replacement ([R29])', async () => {
    const withSandboxDoi = paperRepo(BARE_MYST + '  doi: 10.5072/zenodo.5\n');
    const noop = new ZenodoApi(fakeTransport(() => ({ json: hits([]) })).transport, true, 't');

    // A sandbox prepare over a committed sandbox DOI is refused (same environment).
    const same = await cmdPrepare({
      mystPath: withSandboxDoi,
      repo: 'o/r',
      api: noop,
      instanceRoot: null,
    });
    expect(same.exitCode).toBe(2);

    // A production prepare over a committed sandbox DOI is allowed (a new production concept DOI).
    const prodPath = paperRepo(BARE_MYST + '  doi: 10.5072/zenodo.5\n');
    const { transport } = prepareZenodo('8');
    const prodApi = new ZenodoApi(transport, false, 't');
    const up = await cmdPrepare({
      mystPath: prodPath,
      repo: 'o/r',
      api: prodApi,
      instanceRoot: null,
    });
    expect(up.exitCode).toBe(0);
    expect(up.result.concept_doi).toBe('10.5281/zenodo.8');
  });

  it('forbids prod→sandbox downgrade ([R29])', async () => {
    const prodDoi = paperRepo(BARE_MYST + '  doi: 10.5281/zenodo.5\n');
    const noop = new ZenodoApi(fakeTransport(() => ({ json: hits([]) })).transport, true, 't');
    const out = await cmdPrepare({
      mystPath: prodDoi,
      repo: 'o/r',
      api: noop,
      instanceRoot: null,
    });
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('downgrade');
  });
});

describe('the Project Website link', () => {
  /** A journal checkout holding only `registry/papers.yml`. */
  function journalWith(registry: string): string {
    const root = mkdtempSync(join(tmpdir(), 'oak-journal-'));
    mkdirSync(join(root, 'registry'));
    writeFileSync(join(root, 'registry', 'papers.yml'), registry);
    return root;
  }

  it("defaults to the paper's GitHub Pages URL, also without a journal or a registry", () => {
    expect(defaultSiteUrl('Acme/paper', null)).toBe('https://acme.github.io/paper/');
    expect(defaultSiteUrl('acme/acme.github.io', journalWith('[]'))).toBe(
      'https://acme.github.io/',
    );
  });

  it("takes the site_url of the paper's own registry entry, matching the repo in any case", () => {
    const journal = journalWith(
      '- id: other\n  location: acme/other\n  site_url: https://other.example.org/\n' +
        '- id: mine\n  location: Acme/Paper\n  site_url: https://journal.example.org/mine\n',
    );
    expect(defaultSiteUrl('acme/paper', journal)).toBe('https://journal.example.org/mine');
    expect(defaultSiteUrl('acme/third', journal)).toBe('https://acme.github.io/third/');
  });

  it('is left out without a repo', () => {
    expect(defaultSiteUrl(null, null)).toBeUndefined();
  });

  /** The metadata `cmdPrepare` sends, for a run given `siteUrl`. */
  async function preparedMetadata(siteUrl?: string): Promise<any> {
    const { transport, calls } = prepareZenodo('5');
    const api = new ZenodoApi(transport, true, 't');
    const out = await cmdPrepare({
      mystPath: paperRepo(BARE_MYST),
      repo: 'o/r',
      siteUrl,
      api,
      instanceRoot: null,
    });
    expect(out.exitCode).toBe(0);
    return (calls.find((c) => c.method === 'POST')!.opts.json as any).metadata;
  }

  it('links the default from the description and the related identifiers', async () => {
    const md = await preparedMetadata();
    expect(md.description).toContain(
      'Project Website: <a href="https://o.github.io/r/">https://o.github.io/r/</a>',
    );
    expect(md.related_identifiers).toContainEqual({
      identifier: 'https://o.github.io/r/',
      relation_type: { id: 'isidenticalto' },
      scheme: 'url',
    });
  });

  it('uses --site-url when given, and an empty one leaves the link out', async () => {
    expect((await preparedMetadata('https://x.example.org/')).description).toContain(
      'href="https://x.example.org/"',
    );
    expect((await preparedMetadata('')).description).not.toContain('Project Website');
  });
});

describe('cmdPublish', () => {
  /** A paper tree ready to publish against concept DOI 10.5072/zenodo.5. */
  function readyPaper(): string {
    const mystPath = paperRepo(
      BARE_MYST + '  doi: 10.5072/zenodo.5\n  github: https://github.com/o/r\n',
    );
    writeFileSync(mystPath.replace('myst.yml', 'paper.pdf'), '%PDF');
    withBuild(mystPath);
    return mystPath;
  }
  function publish(
    mystPath: string,
    api: ZenodoApi,
    instanceRoot: string | null = null,
    git: GitContext = fakeGit,
  ) {
    return cmdPublish({
      mystPath,
      pdf: mystPath.replace('myst.yml', 'paper.pdf'),
      tag: 'v1.0.0',
      bundleOut: mystPath.replace('myst.yml', '_bundle'),
      api,
      git,
      instanceRoot,
      engineRoot: mystPath.replace('myst.yml', ''),
    });
  }

  it('populates the reserved draft: metadata overwrite + all bundle files uploaded', async () => {
    const z = fakeZenodo();
    const out = await publish(readyPaper(), z.api);
    expect(out.exitCode).toBe(0);
    expect(out.result.version_doi).toBe('10.5072/zenodo.5');
    expect(out.result.deposition_id).toBe(5);
    expect(z.uploaded.sort()).toEqual([
      'engine.zip',
      'myst.yml',
      'paper.pdf',
      'publication-provenance.json',
      'source.zip',
    ]);
    // Each file is declared, sent, then committed.
    const steps = z.calls
      .filter((c) => pathOf(c.url).includes('/draft/files/paper.pdf'))
      .map((c) => `${c.method} ${pathOf(c.url)}`);
    expect(steps).toEqual([
      'PUT /api/records/5/draft/files/paper.pdf/content',
      'POST /api/records/5/draft/files/paper.pdf/commit',
    ]);
    const content = z.calls.find((c) => pathOf(c.url).endsWith('paper.pdf/content'))!;
    expect(content.opts.headers?.['Content-Type']).toBe('application/octet-stream');
  });

  it('removes every file the draft holds before uploading the bundle ([R28])', async () => {
    const z = fakeZenodo(undefined, ['paper.pdf', 'template.zip']);
    const out = await publish(readyPaper(), z.api);
    expect(out.exitCode).toBe(0);
    expect(z.deleted.sort()).toEqual(['paper.pdf', 'template.zip']);
    expect(z.uploaded).toContain('paper.pdf');
    expect(z.uploaded).not.toContain('template.zip');
    const steps = z.calls.map((c) => c.method);
    expect(steps.lastIndexOf('DELETE')).toBeLessThan(steps.indexOf('POST'));
  });

  it('fails before uploading when Zenodo lists validation errors on the saved draft', async () => {
    const invalid = rec({
      id: '5',
      parent: { id: '5' },
      errors: [
        { field: 'files.enabled', messages: ['Missing uploaded files.'] },
        { field: 'metadata.rights.0.id', messages: ['Unknown license.'] },
      ],
    });
    const z = fakeZenodo(invalid);
    await expect(publish(readyPaper(), z.api)).rejects.toThrow(
      /invalid metadata: metadata\.rights\.0\.id: Unknown license\.$/,
    );
    expect(z.uploaded).toEqual([]);
  });

  it("asks an editor for a new version when the concept's newest version is published", async () => {
    const published = rec({
      id: '5',
      parent: { id: '5' },
      is_published: true,
      is_draft: false,
      links: { self_html: 'https://sandbox.zenodo.org/records/5' },
    });
    const z = fakeZenodo(published);
    const out = await publish(readyPaper(), z.api);
    expect(out.exitCode).toBe(5);
    expect(out.result.record_url).toBe('https://sandbox.zenodo.org/records/5');
    expect(z.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('finds the newest version by its parent, and reads that draft', async () => {
    const z = fakeZenodo();
    await publish(readyPaper(), z.api);
    const search = z.calls.find((c) => pathOf(c.url) === '/api/user/records')!;
    expect(search.opts.params?.q).toBe('parent.id:5');
    expect(
      z.calls.some((c) => c.method === 'GET' && pathOf(c.url) === '/api/records/5/draft'),
    ).toBe(true);
  });

  it('refuses a draft whose parent is another concept', async () => {
    const z = fakeZenodo(rec({ id: '5', parent: { id: '4' } }));
    const out = await publish(readyPaper(), z.api);
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('sanity check');
  });

  it("requests the journal's community for a first version only ([R19])", async () => {
    const reviewOf = (z: ReturnType<typeof fakeZenodo>) =>
      z.calls.filter((c) => pathOf(c.url).endsWith('/draft/review'));
    const journal = journalWithCommunity('fixture-community');
    const git: GitContext = { ...fakeGit, originRepo: async () => 'o/journal' };
    /** A paper built against `journal`, so the deposit reads its settings. */
    const builtAgainstJournal = (): string => {
      const mystPath = readyPaper();
      const doc = parseDocument('version: 1\n');
      doc.setIn(['project', 'options', 'oaktree-sapling'], {
        version: 'v1.0.0',
        edition: 'e',
        journal: { repo: 'o/journal', commit: 'a'.repeat(40) },
      });
      writeFileSync(mystPath.replace('myst.yml', 'myst.oak.yml'), doc.toString());
      return mystPath;
    };

    const first = fakeZenodo();
    expect((await publish(builtAgainstJournal(), first.api, journal, git)).exitCode).toBe(0);
    expect(reviewOf(first)).toHaveLength(1);

    // Zenodo takes no review for a new version: it stays in its first version's communities.
    const next = fakeZenodo(rec({ id: '9', parent: { id: '5' }, versions: { index: 2 } }));
    expect((await publish(builtAgainstJournal(), next.api, journal, git)).exitCode).toBe(0);
    expect(reviewOf(next)).toHaveLength(0);
  });

  it('errors when --sandbox disagrees with the committed DOI prefix', async () => {
    const mystPath = paperRepo(
      BARE_MYST + '  doi: 10.5072/zenodo.5\n  github: https://github.com/o/r\n',
    );
    writeFileSync(mystPath.replace('myst.yml', 'paper.pdf'), '%PDF');
    const noop = new ZenodoApi(fakeTransport(() => ({ json: {} })).transport, false, 't');
    const out = await cmdPublish({
      mystPath,
      pdf: mystPath.replace('myst.yml', 'paper.pdf'),
      tag: 'v1.0.0',
      bundleOut: '/tmp/x',
      api: noop,
      git: fakeGit,
      instanceRoot: null,
      engineRoot: mystPath.replace('myst.yml', ''),
    });
    expect(out.exitCode).toBe(2);
  });

  it('refuses a DOI that is not a Zenodo one, before calling Zenodo', async () => {
    const mystPath = paperRepo(
      BARE_MYST + '  doi: https://doi.org/10.5072/zenodo.5\n  github: https://github.com/o/r\n',
    );
    writeFileSync(mystPath.replace('myst.yml', 'paper.pdf'), '%PDF');
    const { transport, calls } = fakeTransport(() => ({ json: {} }));
    const out = await cmdPublish({
      mystPath,
      pdf: mystPath.replace('myst.yml', 'paper.pdf'),
      tag: 'v1.0.0',
      bundleOut: '/tmp/x',
      api: new ZenodoApi(transport, false, 't'),
      git: fakeGit,
      instanceRoot: null,
      engineRoot: mystPath.replace('myst.yml', ''),
    });
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('is not a Zenodo DOI');
    expect(calls).toHaveLength(0);
  });

  it('refuses a project.github that is not a github.com repo URL, before calling Zenodo', async () => {
    const mystPath = paperRepo(
      BARE_MYST + '  doi: 10.5072/zenodo.5\n  github: https://gitlab.com/o/r\n',
    );
    writeFileSync(mystPath.replace('myst.yml', 'paper.pdf'), '%PDF');
    const { transport, calls } = fakeTransport(() => ({ json: {} }));
    const out = await cmdPublish({
      mystPath,
      pdf: mystPath.replace('myst.yml', 'paper.pdf'),
      tag: 'v1.0.0',
      bundleOut: '/tmp/x',
      api: new ZenodoApi(transport, true, 't'),
      git: fakeGit,
      instanceRoot: null,
      engineRoot: mystPath.replace('myst.yml', ''),
    });
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain(`project.github in ${mystPath}`);
    expect(calls).toEqual([]);
  });
});

const PROVENANCE = {
  repo: 'o/r',
  commit_sha: 'x',
  tag: 'v1.0.0',
  site_url: undefined,
  concept_doi: 'd',
  version_doi: 'v',
  review_pr: null,
  journal_repo: null,
  journal_commit: null,
  built_at: 'now',
  platform: 'linux-x86_64',
  typst_version: '0.14.2',
};

describe('deposit integrity ([R107])', () => {
  it('sends the whole metadata object to the draft at publish ([R22])', async () => {
    const mystPath = paperRepo(
      BARE_MYST + '  doi: 10.5072/zenodo.5\n  github: https://github.com/o/r\n',
    );
    writeFileSync(mystPath.replace('myst.yml', 'paper.pdf'), '%PDF');
    withBuild(mystPath, 'The abstract.');
    const z = fakeZenodo();
    const out = await cmdPublish({
      mystPath,
      pdf: mystPath.replace('myst.yml', 'paper.pdf'),
      tag: 'v1.2.3',
      bundleOut: mystPath.replace('myst.yml', '_bundle'),
      api: z.api,
      git: fakeGit,
      instanceRoot: null,
      engineRoot: mystPath.replace('myst.yml', ''),
    });
    expect(out.exitCode).toBe(0);
    expect(z.bodies).toHaveLength(1);
    const md = z.bodies[0]!.metadata;
    expect(md.title).toBe('A Paper');
    expect(md.version).toBe('1.2.3');
    expect(md.publication_date).toBeTruthy();
    expect(String(md.description)).toContain('The abstract.');
  });

  it('refuses to publish from a tree the build never ran in', async () => {
    const mystPath = paperRepo(
      BARE_MYST + '  doi: 10.5072/zenodo.5\n  github: https://github.com/o/r\n',
    );
    writeFileSync(mystPath.replace('myst.yml', 'paper.pdf'), '%PDF');
    const { transport, calls } = fakeTransport(() => ({ json: [] }));
    const out = await cmdPublish({
      mystPath,
      pdf: mystPath.replace('myst.yml', 'paper.pdf'),
      tag: 'v1.0.0',
      bundleOut: mystPath.replace('myst.yml', '_bundle'),
      api: new ZenodoApi(transport, true, 't'),
      git: fakeGit,
      instanceRoot: null,
      engineRoot: mystPath.replace('myst.yml', ''),
    });
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('_build/site/content');
    expect(calls.length, 'the description downgrade is caught before any Zenodo write').toBe(0);
  });

  it('refuses an engine.zip that carries no engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-hollow-'));
    writeFileSync(join(root, 'paper.pdf'), '%PDF');
    const hollow: GitContext = {
      ...fakeGit,
      async gitArchive(_r, outZip) {
        new AdmZip().writeZip(outZip); // what `git archive` produces off a non-release ref
      },
    };
    await expect(
      buildBundle(join(root, '_bundle'), join(root, 'paper.pdf'), root, root, PROVENANCE, hollow),
    ).rejects.toThrow(EngineArchiveError);
  });

  it('encodes an author-controlled filename into the upload path', async () => {
    const seen: string[] = [];
    const { transport } = fakeTransport((r) => {
      seen.push(r.url);
      return { json: {} };
    });
    const api = new ZenodoApi(transport, true, 't');
    await api.uploadFile('1', 'data?v2.csv', new Uint8Array());
    const content = new URL(seen.find((u) => u.endsWith('/content'))!);
    expect(content.pathname).toBe('/api/records/1/draft/files/data%3Fv2.csv/content');
    for (const u of seen) {
      expect(
        new URL(u).searchParams.size,
        'nothing may ride into the token-bearing query string',
      ).toBe(0);
    }
  });

  it('derives the API host from sandbox, so the two cannot disagree', () => {
    const t = fakeTransport(() => ({ json: {} })).transport;
    expect(new ZenodoApi(t, true, 'x').api).toBe(ZENODO_SANDBOX);
    expect(new ZenodoApi(t, false, 'x').api).toBe(ZENODO_PROD);
  });
});

describe('finding the deposit, and the checks before it [R100] [R101]', () => {
  const id = 'foo-bar';
  const gh = 'https://github.com/o/r';

  it('scans when a targeted query returns rows that do not match', async () => {
    // A phrase match returns a LONGER urn for a query about a shorter one ([R100]).
    const nearMiss = rec({
      id: '1',
      metadata: { related_identifiers: [{ identifier: paperUrn('foo-bar-baz') }] },
    });
    const real = rec({
      id: '2',
      metadata: { related_identifiers: [{ identifier: paperUrn(id) }] },
    });
    let unfiltered = 0;
    const { transport } = fakeTransport(({ opts }) => {
      const q = opts.params?.q;
      if (q === undefined) {
        unfiltered++;
        return { json: hits([nearMiss, real]) };
      }
      // The URN query returns the near miss; the GitHub query misses (a renamed repo [R7]).
      return { json: hits(String(q).includes(id) ? [nearMiss] : []) };
    });
    const api = new ZenodoApi(transport, true, 't');
    const found = await api.findDeposit({ paperId: id, githubUrl: gh });
    expect(found?.id, 'a near miss must not suppress the scan').toBe('2');
    expect(unfiltered).toBe(1);
  });

  it('judges the working tree before any Zenodo write', () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-precond-'));
    mkdirSync(join(root, 'deposit'), { recursive: true });
    writeFileSync(join(root, 'deposit', 'paper.pdf'), 'x');
    expect(() => assertBundlePreconditions(root, root)).toThrow(BundleCollisionError);
  });

  it('reports a reserved name in the result, having sent nothing to Zenodo', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oak-envelope-'));
    mkdirSync(join(root, 'deposit'), { recursive: true });
    writeFileSync(join(root, 'deposit', 'source.zip'), 'x');
    writeFileSync(join(root, 'paper.pdf'), 'x');
    writeFileSync(
      join(root, 'myst.yml'),
      'version: 1\nproject:\n  id: p\n  doi: 10.5072/zenodo.5\n  github: https://github.com/o/r\n',
    );
    const { transport, calls } = fakeTransport(() => ({ json: [] }));
    const out = await cmdPublish({
      mystPath: join(root, 'myst.yml'),
      pdf: join(root, 'paper.pdf'),
      tag: 'v1.0.0',
      siteUrl: 'https://s',
      bundleOut: join(root, '_bundle'),
      api: new ZenodoApi(transport, true, 't'),
      git: fakeGit,
      instanceRoot: null,
      engineRoot: root,
    });
    expect(out.result.status).toBe('error');
    expect(out.exitCode).toBe(2);
    expect(JSON.stringify(out.result)).toContain('source.zip');
    expect(calls.length, 'nothing may reach Zenodo before the tree is judged').toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * The journal the build used, archived as journal.zip [R66]
 * ------------------------------------------------------------------------ */

describe('journal.zip', () => {
  const COMMIT = 'a'.repeat(40);

  const STAMPED = { repo: 'o/journal', commit: COMMIT };

  /** A paper tree as `oak build` leaves it, with `journal` as the derived config's stamp. */
  function builtPaper(journal?: unknown): string {
    const mystPath = paperRepo(
      BARE_MYST + '  doi: 10.5072/zenodo.5\n  github: https://github.com/o/r\n',
    );
    const root = mystPath.replace('myst.yml', '');
    writeFileSync(join(root, 'paper.pdf'), '%PDF');
    withBuild(mystPath);
    const doc = parseDocument('version: 1\n');
    doc.setIn(['project', 'options', 'oaktree-sapling'], { version: 'v1.0.0', edition: 'e' });
    if (journal !== undefined) {
      doc.setIn(['project', 'options', 'oaktree-sapling', 'journal'], journal);
    }
    writeFileSync(join(root, 'myst.oak.yml'), doc.toString());
    return root;
  }

  /** A git context recording what was fetched and archived, with `origin` as the journal's. */
  function recordingGit(origin: string | null, fetchFails = false) {
    const fetched: string[] = [];
    const archived: Array<{ root: string; zip: string; commit: string }> = [];
    const git: GitContext = {
      ...fakeGit,
      async gitArchive(root, outZip, commit = 'HEAD') {
        archived.push({ root, zip: outZip.split('/').pop()!, commit });
        await fakeGit.gitArchive(root, outZip);
      },
      async fetchCommit(_root, commit) {
        if (fetchFails) throw new Error('not our ref');
        fetched.push(commit);
      },
      async originRepo() {
        return origin;
      },
    };
    return { git, fetched, archived };
  }

  /** A Zenodo fake that accepts the publish and records the uploads and every call. */
  const zenodo = () => fakeZenodo();

  function publish(root: string, git: GitContext, api: ZenodoApi, instanceRoot: string | null) {
    return cmdPublish({
      mystPath: join(root, 'myst.yml'),
      pdf: join(root, 'paper.pdf'),
      tag: 'v1.0.0',
      bundleOut: join(root, '_bundle'),
      api,
      git,
      instanceRoot,
      engineRoot: root,
    });
  }

  it('archives the commit the build recorded, fetched into the --instance clone', async () => {
    const root = builtPaper(STAMPED);
    const journalRoot = mkdtempSync(join(tmpdir(), 'oak-journal-'));
    const { git, fetched, archived } = recordingGit('o/journal');
    const z = zenodo();
    const out = await publish(root, git, z.api, journalRoot);
    expect(out.exitCode).toBe(0);
    expect(fetched).toEqual([COMMIT]);
    expect(archived).toContainEqual({ root: journalRoot, zip: 'journal.zip', commit: COMMIT });
    expect(z.uploaded).toContain('journal.zip');
    expect(z.uploaded).toContain('myst.oak.yml');
    expect(z.provenance[0]).toMatchObject({ journal_repo: 'o/journal', journal_commit: COMMIT });
  });

  it("matches the clone's repo case-insensitively, as GitHub does", async () => {
    const root = builtPaper(STAMPED);
    const journalRoot = mkdtempSync(join(tmpdir(), 'oak-journal-'));
    const out = await publish(root, recordingGit('O/Journal').git, zenodo().api, journalRoot);
    expect(out.exitCode).toBe(0);
  });

  it("records the paper's own repo and commit when the paper is its own journal", async () => {
    const root = builtPaper({ repo: '.' });
    const { git, archived } = recordingGit(null);
    const z = zenodo();
    const out = await publish(root, git, z.api, null);
    expect(out.exitCode).toBe(0);
    expect(z.uploaded).not.toContain('journal.zip');
    expect(archived.map((a) => a.zip)).not.toContain('journal.zip');
    expect(z.provenance[0]).toMatchObject({ journal_repo: 'o/r', journal_commit: 'deadbeef' });
  });

  it('adds no journal.zip for a build without a journal', async () => {
    const root = builtPaper();
    const z = zenodo();
    const out = await publish(root, recordingGit(null).git, z.api, null);
    expect(out.exitCode).toBe(0);
    expect(z.uploaded).not.toContain('journal.zip');
    expect(z.provenance[0]).toMatchObject({ journal_repo: null, journal_commit: null });
  });

  it.each<{
    why: string;
    journal?: unknown;
    origin?: string;
    fetchFails?: boolean;
    instance?: boolean;
    says: string;
  }>([
    { why: 'the clone is of another journal', origin: 'o/other', says: 'o/other' },
    { why: 'the commit cannot be fetched', fetchFails: true, says: COMMIT },
    {
      why: 'the build used uncommitted journal files',
      journal: { repo: 'o/journal', commit: null },
      says: 'not a commit of their own repo',
    },
    {
      why: 'the stamp is not valid',
      journal: { repo: 'o/journal', commit: '--x' },
      says: 'myst.oak.yml',
    },
    { why: 'no --instance was given', instance: false, says: `o/journal@${COMMIT}` },
  ])(
    'refuses before any Zenodo write when $why',
    async ({
      journal = STAMPED,
      origin = 'o/journal',
      fetchFails = false,
      instance = true,
      says,
    }) => {
      const root = builtPaper(journal);
      const z = zenodo();
      const journalRoot = instance ? mkdtempSync(join(tmpdir(), 'oak-journal-')) : null;
      const out = await publish(root, recordingGit(origin, fetchFails).git, z.api, journalRoot);
      expect(out.exitCode).toBe(2);
      expect(String(out.result.message)).toContain(says);
      expect(z.calls).toHaveLength(0);
    },
  );
});
