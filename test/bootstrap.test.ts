/**
 * `oak bootstrap`, with a fake provisioner (no gh or git): the rendered pins.yml, CODEOWNERS
 * and myst.yml, the rest copied as is; `--from` restoring the editor's `.github/`; reruns that
 * read before they change; secrets set when given, otherwise listed in the runbook; the bypass
 * for an org team or a personal account; and the two journal setups, `--external` (settings
 * and website, public) and `--co-located` (the paper workflows and a starter paper, no website).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { themeZipUrl } from '../src/assets.js';
import {
  renderPaperTemplate,
  renderInstanceTemplate,
  renderSiteTemplate,
  galleryPluginUrl,
  siteUrlFor,
  engineMystRange,
  buildReviewTree,
  cmdBootstrapPaper,
  cmdBootstrapJournal,
  RULESET_V_TAGS,
  RULESET_PROTECT_MAIN,
  type Provisioner,
  type EnvironmentReviewer,
  type TemplateAnswers,
  type BootstrapDeps,
} from '../src/bootstrap.js';
import { LABEL_EDITOR_ACTION, LABEL_ZENODO_FAILED } from '../src/preview.js';

const PAPER_ROOT = 'templates/paper';
const INSTANCE_ROOT = 'templates/instance';
const SITE_ROOT = 'templates/site';
const MYST_RANGE = '^9.9.9';
const tmp = (p = 'oak-bs-') => mkdtempSync(join(tmpdir(), p));

const answers = (over: Partial<TemplateAnswers> = {}): TemplateAnswers => ({
  engineRepo: 'me/engine',
  instanceRepo: 'me/instance-config',
  owner: '@alice',
  version: 'v1.2.3',
  edition: 'ed-2026',
  journalName: 'Test Journal',
  ...over,
});

/* --------------------------------------------------------------------------
 * renderPaperTemplate / renderInstanceTemplate
 * ------------------------------------------------------------------------ */

describe('renderPaperTemplate', () => {
  it('renders pins.yml, CODEOWNERS and myst.yml, and copies the rest as is', () => {
    const dest = tmp();
    const written = renderPaperTemplate(PAPER_ROOT, dest, answers());

    const pins = parseDocument(readFileSync(join(dest, '.github/actions/engine/pins.yml'), 'utf8'));
    expect(pins.get('engine_repo')).toBe('me/engine');
    expect(pins.get('instance_repo')).toBe('me/instance-config');

    const co = readFileSync(join(dest, 'CODEOWNERS'), 'utf8');
    expect(co).toMatch(/\/\.github\/\s+@alice/);
    expect(co).toMatch(/\/CODEOWNERS\s+@alice/);
    expect(co).not.toContain('@pollomarzo');

    const myst = parseDocument(readFileSync(join(dest, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'options', 'oaktree-sapling', 'version'])).toBe('v1.2.3');
    expect(myst.getIn(['project', 'options', 'oaktree-sapling', 'edition'])).toBe('ed-2026');

    // A copied file is identical to its source.
    const rel = '.github/workflows/ci.yml';
    expect(readFileSync(join(dest, rel), 'utf8')).toBe(readFileSync(join(PAPER_ROOT, rel), 'utf8'));

    // oak's own README is not copied; the journal template is a separate tree.
    expect(existsSync(join(dest, 'README.md'))).toBe(false);
    expect(existsSync(join(dest, 'journal.yml'))).toBe(false);
    expect(written).toContain('.github/workflows/version-bump.yml');
  });

  it('seeds a LICENSE for the licence the edition states [R127]', () => {
    const dest = tmp();
    const written = renderPaperTemplate(PAPER_ROOT, dest, answers());
    expect(written).toContain('LICENSE');
    // The seeded edition states a licence to readers and to Zenodo, so the paper repo carries
    // the matching text.
    const edition = parseDocument(
      readFileSync(join(INSTANCE_ROOT, 'editions/edition.yml'), 'utf8'),
    );
    expect(edition.getIn(['project', 'license'])).toBe('CC-BY-4.0');
    expect(readFileSync(join(dest, 'LICENSE'), 'utf8')).toContain(
      'Creative Commons Attribution 4.0 International Public License',
    );
  });

  it('ships the thumbnail paper-base.yml declares, so the journal gallery finds an image', () => {
    const dest = tmp();
    const written = renderPaperTemplate(PAPER_ROOT, dest, answers());
    const base = parseDocument(readFileSync('paper-base.yml', 'utf8'));
    const thumb = String(base.getIn(['project', 'thumbnail']));
    expect(written).toContain(thumb);
    const png = readFileSync(join(dest, thumb));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  it('sets project.github to the new repo, after the title, so a starter paper links its source', () => {
    const dest = tmp();
    renderPaperTemplate(PAPER_ROOT, dest, answers({ repo: 'me/paper' }));
    const myst = parseDocument(readFileSync(join(dest, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'github'])).toBe('https://github.com/me/paper');
    const keys = (myst.toJS() as { project: Record<string, unknown> }).project;
    expect(Object.keys(keys).slice(0, 3)).toEqual(['id', 'title', 'github']);
  });

  it('co-located writes instance_repo: .', () => {
    const dest = tmp();
    renderPaperTemplate(PAPER_ROOT, dest, answers({ instanceRepo: '.' }));
    const pins = parseDocument(readFileSync(join(dest, '.github/actions/engine/pins.yml'), 'utf8'));
    expect(pins.get('instance_repo')).toBe('.');
  });
});

describe('renderInstanceTemplate', () => {
  it('sets journal name and renames the edition file to <edition>.yml', () => {
    const dest = tmp();
    renderInstanceTemplate(INSTANCE_ROOT, dest, answers({ edition: 'ed-2026' }));
    const journal = parseDocument(readFileSync(join(dest, 'journal.yml'), 'utf8'));
    expect(journal.get('name')).toBe('Test Journal');
    expect(existsSync(join(dest, 'editions/ed-2026.yml'))).toBe(true);
    expect(existsSync(join(dest, 'editions/edition.yml'))).toBe(false);
    expect(existsSync(join(dest, 'brand/logo.svg'))).toBe(true);
    expect(existsSync(join(dest, 'registry/papers.yml'))).toBe(true);
  });

  it('--name reaches the brand, the edition venue and the Zenodo blurb, not only journal.yml', () => {
    const dest = tmp();
    renderInstanceTemplate(INSTANCE_ROOT, dest, answers({ journalName: 'Acta: Tests #1' }));
    const brand = parseDocument(readFileSync(join(dest, 'brand/brand.yml'), 'utf8'));
    expect(brand.getIn(['site', 'options', 'logo_text'])).toBe('Acta: Tests #1');
    const edition = parseDocument(readFileSync(join(dest, 'editions/ed-2026.yml'), 'utf8'));
    expect(edition.getIn(['project', 'venue'])).toBe('Acta: Tests #1');
    const journal = readFileSync(join(dest, 'journal.yml'), 'utf8');
    expect(parseDocument(journal).get('name')).toBe('Acta: Tests #1');
    expect(journal).toContain('Published in Acta: Tests #1.');
    for (const f of ['journal.yml', 'brand/brand.yml', 'editions/ed-2026.yml'])
      expect(readFileSync(join(dest, f), 'utf8'), f).not.toContain('CHANGE-ME Journal');
  });

  it('without --name the files keep their placeholder as shipped', () => {
    const dest = tmp();
    renderInstanceTemplate(INSTANCE_ROOT, dest, answers({ journalName: undefined }));
    expect(readFileSync(join(dest, 'brand/brand.yml'), 'utf8')).toBe(
      readFileSync(join(INSTANCE_ROOT, 'brand/brand.yml'), 'utf8'),
    );
    expect(readFileSync(join(dest, 'editions/ed-2026.yml'), 'utf8')).toBe(
      readFileSync(join(INSTANCE_ROOT, 'editions/edition.yml'), 'utf8'),
    );
  });
});

describe('siteUrlFor', () => {
  it('is a project site under the repo name, with a lowercase owner', () => {
    expect(siteUrlFor('Me/Config')).toBe('https://me.github.io/Config/');
  });

  it('is the root for a repo named <owner>.github.io', () => {
    expect(siteUrlFor('Me/me.github.io')).toBe('https://me.github.io/');
  });
});

describe('renderSiteTemplate', () => {
  it('renders the four values and copies the rest as is', () => {
    const dest = tmp();
    const written = renderSiteTemplate(SITE_ROOT, dest, answers(), MYST_RANGE);

    const myst = parseDocument(readFileSync(join(dest, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'title'])).toBe('Test Journal');
    // Rendered from the constant, so the two cannot differ.
    expect(myst.getIn(['site', 'template'])).toBe(themeZipUrl());
    expect(myst.getIn(['project', 'plugins', 0])).toBe(galleryPluginUrl('me/engine', 'v1.2.3'));
    // The brand is a single local extends entry, so no other entry competes for its keys [R72].
    expect(myst.get('extends')?.toJSON()).toEqual(['./brand/brand.yml']);

    const index = readFileSync(join(dest, 'pages/index.md'), 'utf8');
    expect(index).toContain('# Test Journal');
    expect(index).not.toContain('{{');

    // One dependency list: MyST is pinned in package.json beside the plugin's js-yaml, so the
    // workflow needs no version of its own and is copied as is.
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['mystmd']).toBe(MYST_RANGE);
    expect(pkg.dependencies['js-yaml']).toBeTruthy(); // resolved from this repo's node_modules

    // Copied as is, so none of our `{{token}}`s are left. Its `${{ … }}` are GitHub Actions
    // expressions.
    const wf = readFileSync(join(dest, '.github/workflows/site.yml'), 'utf8');
    expect(wf).toBe(readFileSync(join(SITE_ROOT, '.github/workflows/site.yml'), 'utf8'));
    expect(wf).not.toContain('mystmd@');
    // A remote plugin is imported from _build/cache/, so its bare imports resolve against this
    // repo's node_modules, which the install provides.
    expect(wf).toContain('npm install');
    // --strict catches a remote plugin that failed to load.
    expect(wf).toContain('--strict');
    // BASE_URL from configure-pages: the site is served at `<owner>.github.io/<repo>/`, and MyST
    // needs it to write asset URLs under that path.
    expect(wf).toContain('configure-pages');
    expect(wf).toContain('BASE_URL: ${{ steps.pages.outputs.base_path }}');
    // A plugin that never loads does not fail --strict: myst logs "Unknown plugin" and
    // "unknown directive" and exits 0. So the workflow looks for the plugin's own name in the
    // build log.
    expect(wf).toContain('Paper Gallery.*loaded');

    // Ships as `gitignore` and is written as `.gitignore`, since npm leaves `.gitignore` out of
    // every package.
    expect(readFileSync(join(dest, '.gitignore'), 'utf8')).toBe(
      readFileSync(join(SITE_ROOT, 'gitignore'), 'utf8'),
    );
    expect(existsSync(join(dest, 'README.md'))).toBe(false); // one repo, one README
  });

  it("the plugin URL is pinned to oak's tag, not a branch", () => {
    const dest = tmp();
    renderSiteTemplate(SITE_ROOT, dest, answers({ version: 'v2.0.0' }), MYST_RANGE);
    const myst = parseDocument(readFileSync(join(dest, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'plugins', 0])).toBe(
      'https://raw.githubusercontent.com/me/engine/v2.0.0/plugins/gallery.mjs',
    );
  });
});

describe('engineMystRange', () => {
  it("copies the myst-cli range from oak's package.json as written", () => {
    // myst-cli is in devDependencies, since it is bundled; npm publishes that block as it is, so
    // the range can still be read. Either block counts: the range is copied, not parsed.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = pkg.dependencies?.['myst-cli'] ?? pkg.devDependencies?.['myst-cli'];
    expect(declared).toBeTruthy();
    expect(engineMystRange('.')).toBe(declared);
  });
});

describe('buildReviewTree (--from)', () => {
  it("restores the editor's whole .github, including pins.yml, and drops the author's", () => {
    const author = {
      'index.md': 'author paper',
      '.github/actions/engine/pins.yml': 'engine_repo: EVIL/attacker',
      '.github/workflows/ci.yml': 'malicious',
    };
    const main = {
      '.github/actions/engine/pins.yml': 'engine_repo: me/engine',
      '.github/workflows/ci.yml': 'frozen ci',
      CODEOWNERS: '/.github/ @alice',
    };
    const review = buildReviewTree(author, main);
    expect(review['index.md']).toBe('author paper'); // author content survives
    expect(review['.github/actions/engine/pins.yml']).toBe('engine_repo: me/engine'); // the editor's
    expect(review['.github/workflows/ci.yml']).toBe('frozen ci');
    expect(review['CODEOWNERS']).toBe('/.github/ @alice');
  });
});

/* --------------------------------------------------------------------------
 * Fake Provisioner
 * ------------------------------------------------------------------------ */

interface FakeState {
  ownerType?: 'Organization' | 'User';
  repos?: Set<string>;
  branches?: Set<string>; // "repo/branch"
  defaultBranch?: string;
  rulesets?: Set<string>; // "repo/name"
  pages?: Set<string>;
  policies?: Set<string>; // "repo/env/name"
  visibility?: 'public' | 'private';
  actionsCanApprovePrs?: boolean;
  environments?: Set<string>; // "repo/env"
  reviewers?: EnvironmentReviewer[]; // what the zenodo-publish env already has
  openEnvironments?: Set<string>; // "repo/env" that exist but admit every branch
  secrets?: Set<string>; // "repo/env/name", or "repo/name" for a repository secret
}

function fakeProv(state: FakeState = {}) {
  const calls: Record<string, unknown[]> = {
    createRepo: [],
    allowActionsApprovePrs: [],
    seedBranch: [],
    setDefaultBranch: [],
    ingestReviewBranch: [],
    openPr: [],
    grantTeamWrite: [],
    createRuleset: [],
    enablePages: [],
    upsertEnvironment: [],
    createBranchPolicy: [],
    createLabel: [],
    setSecret: [],
    deleteRepoSecret: [],
    setRepoPublic: [],
  };
  const rec = (k: string, ...args: unknown[]) => calls[k]!.push(args.length === 1 ? args[0] : args);
  const prov: Provisioner = {
    ownerType: () => state.ownerType ?? 'User',
    repoExists: (r) => state.repos?.has(r) ?? false,
    createRepo: (r, o) => rec('createRepo', { r, o }),
    branchExists: (r, b) => state.branches?.has(`${r}/${b}`) ?? false,
    defaultBranch: () => state.defaultBranch ?? 'main',
    setDefaultBranch: (r, b) => rec('setDefaultBranch', { r, b }),
    seedBranch: (r, b, _d, m) => rec('seedBranch', { r, b, m }),
    ingestReviewBranch: (r, o) => rec('ingestReviewBranch', { r, o }),
    prExists: (r, h) => state.branches?.has(`${r}/pr:${h}`) ?? false,
    openPr: (r, o) => {
      rec('openPr', { r, o });
      return `https://github.com/${r}/pull/1`;
    },
    grantTeamWrite: (r, t) => rec('grantTeamWrite', { r, t }),
    teamId: () => 4242,
    rulesetExists: (r, n) => state.rulesets?.has(`${r}/${n}`) ?? false,
    createRuleset: (r, b) => rec('createRuleset', { r, b }),
    pagesEnabled: (r) => state.pages?.has(r) ?? false,
    enablePages: (r) => rec('enablePages', r),
    actionsCanApprovePrs: () => state.actionsCanApprovePrs ?? false,
    allowActionsApprovePrs: (r) => rec('allowActionsApprovePrs', r),
    environmentExists: (r, n) => state.environments?.has(`${r}/${n}`) ?? false,
    environmentReviewers: () => state.reviewers ?? [],
    upsertEnvironment: (r, n, v) => {
      rec('upsertEnvironment', { r, n, v });
      (state.environments ??= new Set()).add(`${r}/${n}`);
      state.openEnvironments?.delete(`${r}/${n}`);
    },
    customBranchPolicies: (r, e) => !state.openEnvironments?.has(`${r}/${e}`),
    branchPolicyExists: (r, e, n) => state.policies?.has(`${r}/${e}/${n}`) ?? false,
    createBranchPolicy: (r, e, n, t) => rec('createBranchPolicy', { r, e, n, t }),
    createLabel: (r, n) => rec('createLabel', { r, n }),
    setSecret: (r, e, n) => rec('setSecret', { r, e, n }),
    secretNames: (r, e) =>
      [...(state.secrets ?? [])]
        .filter((k) => k.startsWith(e ? `${r}/${e}/` : `${r}/`) && (e || k.split('/').length === 3))
        .map((k) => k.split('/').at(-1)!),
    deleteRepoSecret: (r, n) => rec('deleteRepoSecret', { r, n }),
    repoVisibility: () => state.visibility ?? 'public',
    setRepoPublic: (r) => rec('setRepoPublic', r),
  };
  return { prov, calls };
}

/** The PUTs on `zenodo-publish` alone, the environment holding the publish token. */
function zenodoPuts(calls: Record<string, unknown[]>) {
  return (calls.upsertEnvironment as Array<{ n: string }>).filter((c) => c.n === 'zenodo-publish');
}

function deps(prov: Provisioner): BootstrapDeps {
  return {
    prov,
    paperTemplateRoot: PAPER_ROOT,
    instanceTemplateRoot: INSTANCE_ROOT,
    siteTemplateRoot: SITE_ROOT,
    mystRange: MYST_RANGE,
    log: () => {},
    confirm: async () => true,
    workdir: () => tmp('oak-seed-'),
  };
}

const paperInput = (over: Record<string, unknown> = {}) => ({
  repo: 'me/paper',
  // A paper names its journal, or its pins.yml would point at a journal.yml beside it that
  // the render never writes.
  instance: 'me/instance-config',
  edition: 'ed-2026',
  engineVersion: 'v1.2.3',
  engineRepo: 'me/engine',
  authedUser: 'alice',
  private: false,
  requireChecks: true,
  secrets: {},
  ...over,
});

/* --------------------------------------------------------------------------
 * cmdBootstrapPaper
 * ------------------------------------------------------------------------ */

describe('cmdBootstrapPaper', () => {
  it('without --from: creates the repo, seeds main and sets it up, with no review branch', async () => {
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput(), deps(prov));
    expect(out.result.mode).toBe('bare');
    expect(calls.createRepo).toHaveLength(1);
    expect(calls.seedBranch).toHaveLength(1);
    expect(calls.ingestReviewBranch).toHaveLength(0);
    expect(calls.openPr).toHaveLength(0);
    expect(calls.createRuleset).toHaveLength(2); // protect-main + v-tags
    expect(calls.enablePages).toHaveLength(1);
  });

  it('a new paper ends by saying what to fill in, and its myst.yml links the repo', async () => {
    const { prov } = fakeProv();
    const seeds: string[] = [];
    const d = deps(prov);
    d.workdir = () => {
      const dir = tmp('oak-seed-');
      seeds.push(dir);
      return dir;
    };
    const out = await cmdBootstrapPaper(paperInput(), d);
    const runbook = out.result.runbook as string[];
    expect(runbook[0]).toMatch(/^Next: .*myst\.yml: project\.id .*title.*authors/);
    const myst = parseDocument(readFileSync(join(seeds[0]!, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'github'])).toBe('https://github.com/me/paper');

    // An imported paper brings the author's myst.yml, and a rerun has seeded nothing.
    const ingest = await cmdBootstrapPaper(
      paperInput({ from: 'https://github.com/author/paper' }),
      deps(fakeProv().prov),
    );
    expect((ingest.result.runbook as string[]).join('\n')).not.toContain('Next: ');
    const rerun = await cmdBootstrapPaper(
      paperInput(),
      deps(fakeProv({ repos: new Set(['me/paper']), branches: new Set(['me/paper/main']) }).prov),
    );
    expect((rerun.result.runbook as string[]).join('\n')).not.toContain('Next: ');
  });

  it('refuses a paper without --instance before doing anything', async () => {
    // Without --instance, pins.yml would say `instance_repo: .` and point at a journal.yml
    // this render never writes, so the first CI run would fail. It fails here instead.
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput({ instance: undefined }), deps(prov));
    expect(out.exitCode).toBe(2);
    expect(out.result.status).toBe('error');
    expect(String(out.result.error)).toContain('--instance');
    expect(String(out.result.error)).toContain('pins.yml');
    // Nothing was touched: the check precedes every effect.
    expect(calls.createRepo).toHaveLength(0);
    expect(calls.seedBranch).toHaveLength(0);
  });

  it('refuses a paper with no --edition instead of inventing one', async () => {
    // As with --instance: `edition` goes into the paper's myst.yml and must match an
    // editions/<id>.yml the journal already has, so a default would fail in CI.
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput({ edition: undefined }), deps(prov));
    expect(out.exitCode).toBe(2);
    expect(out.result.status).toBe('error');
    expect(String(out.result.error)).toContain('--edition');
    expect(String(out.result.error)).toContain('editions/');
    // The message names the journal, so the reader knows where to look.
    expect(String(out.result.error)).toContain('me/instance-config');
    expect(calls.createRepo).toHaveLength(0);
    expect(calls.seedBranch).toHaveLength(0);
  });

  it('the plan shows every value the run will use, before the prompt', async () => {
    const { prov } = fakeProv();
    const plans: string[][] = [];
    const d = deps(prov);
    d.confirm = async (plan) => {
      plans.push(plan);
      return false;
    };
    await cmdBootstrapPaper(
      paperInput({ resolved: { engineVersionFrom: 'latest-release', engineRepoFrom: 'default' } }),
      d,
    );
    const plan = plans[0]!.join('\n');
    expect(plan).toContain('journal repo   : me/instance-config');
    expect(plan).toContain('edition        : ed-2026');
    // A resolved value says so, and names the flag that sets it.
    expect(plan).toMatch(/engine version : v1\.2\.3: the newest engine release right now/);
    expect(plan).toContain('--engine-version');
    expect(plan).toMatch(/engine repo    : me\/engine: built-in default/);
    expect(plan).toMatch(/review owner   : @alice: your own GitHub login/);
  });

  it('a value that was passed is shown as passed, not as a default', async () => {
    const { prov } = fakeProv();
    const plans: string[][] = [];
    const d = deps(prov);
    d.confirm = async (plan) => {
      plans.push(plan);
      return false;
    };
    await cmdBootstrapPaper(
      paperInput({
        owner: '@org/editors',
        resolved: { engineVersionFrom: 'flag', engineRepoFrom: 'flag' },
      }),
      d,
    );
    const plan = plans[0]!.join('\n');
    expect(plan).toContain('engine version : v1.2.3 (--engine-version)');
    expect(plan).toContain('engine repo    : me/engine (--engine-repo)');
    expect(plan).toContain('review owner   : @org/editors (--owner)');
    expect(plan).not.toContain('no --engine-version given');
  });

  it('--instance . names this repo as the journal, and still bootstraps', async () => {
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput({ instance: '.' }), deps(prov));
    expect(out.exitCode).toBe(0);
    expect(calls.seedBranch).toHaveLength(1);
  });

  it('the instance lands in pins.yml as instance_repo', async () => {
    const { prov, calls } = fakeProv();
    const seedDirs: string[] = [];
    const d = deps(prov);
    d.workdir = () => {
      const dir = tmp('oak-seed-');
      seedDirs.push(dir);
      return dir;
    };
    await cmdBootstrapPaper(paperInput({ instance: 'me/journal' }), d);
    expect(calls.seedBranch).toHaveLength(1);
    const pins = parseDocument(
      readFileSync(join(seedDirs[0]!, '.github/actions/engine/pins.yml'), 'utf8'),
    );
    expect(pins.get('instance_repo')).toBe('me/journal');
  });

  it('an aborted run says why, and a rerun warns that main will not be rewritten', async () => {
    const { prov } = fakeProv({
      repos: new Set(['me/paper']),
      branches: new Set(['me/paper/main']),
    });
    const plans: string[][] = [];
    const d = deps(prov);
    d.confirm = async (plan) => {
      plans.push(plan);
      return false;
    };
    const out = await cmdBootstrapPaper(paperInput(), d);
    expect(out.result.status).toBe('aborted');
    expect(String(out.result.reason)).toContain('not confirmed');
    const plan = plans[0]!.join('\n');
    expect(plan).toContain('will NOT rewrite');
    expect(plan).toContain('pins.yml');
  });

  it('protect-main requires "Journal checks" by default; --no-require-checks omits it', async () => {
    const bodyOf = (calls: Record<string, unknown[]>) =>
      (
        calls.createRuleset as Array<{
          b: {
            name: string;
            rules: Array<{
              type: string;
              parameters?: { required_status_checks?: Array<{ context: string }> };
            }>;
          };
        }>
      ).find((c) => c.b.name === 'protect-main')!.b;
    const hasJournalCheck = (body: ReturnType<typeof bodyOf>) =>
      body.rules.some(
        (r) =>
          r.type === 'required_status_checks' &&
          (r.parameters?.required_status_checks ?? []).some((c) => c.context === 'Journal checks'),
      );

    const on = fakeProv();
    await cmdBootstrapPaper(paperInput(), deps(on.prov));
    expect(hasJournalCheck(bodyOf(on.calls))).toBe(true);

    const off = fakeProv();
    await cmdBootstrapPaper(paperInput({ requireChecks: false }), deps(off.prov));
    expect(hasJournalCheck(bodyOf(off.calls))).toBe(false);
  });

  it('--from: seeds main, builds the review branch, opens a pull request', async () => {
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput({ from: 'https://github.com/a/b' }), deps(prov));
    expect(out.result.mode).toBe('ingest');
    expect(calls.seedBranch).toHaveLength(1);
    expect(calls.ingestReviewBranch).toHaveLength(1);
    expect(calls.openPr).toHaveLength(1);
    expect(out.result.pr).toContain('/pull/');
  });

  it('a rerun skips the repo, main, rulesets, Pages and policies that exist', async () => {
    const { prov, calls } = fakeProv({
      repos: new Set(['me/paper']),
      branches: new Set(['me/paper/main']),
      rulesets: new Set(['me/paper/protect-main', 'me/paper/editors-only-v-tags']),
      pages: new Set(['me/paper']),
      environments: new Set(['me/paper/zenodo-prepare', 'me/paper/preview']),
      policies: new Set([
        'me/paper/zenodo-publish/v*',
        'me/paper/zenodo-prepare/main',
        'me/paper/preview/main',
      ]),
    });
    const out = await cmdBootstrapPaper(paperInput(), deps(prov));
    expect(calls.createRepo).toHaveLength(0);
    expect(calls.seedBranch).toHaveLength(0);
    expect(calls.createRuleset).toHaveLength(0);
    expect(calls.enablePages).toHaveLength(0);
    expect(calls.createBranchPolicy).toHaveLength(0);
    expect((out.result.actions as Record<string, string>).repo).toBe('exists');
  });

  it('sets provided secrets and prints a runbook for the missing ones', async () => {
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput({ secrets: { zenodoToken: 'zt' } }), deps(prov));
    expect(calls.setSecret).toEqual([
      { r: 'me/paper', e: 'zenodo-publish', n: 'ZENODO_TOKEN' },
      { r: 'me/paper', e: 'zenodo-prepare', n: 'ZENODO_TOKEN' },
    ]);
    expect(out.result.secrets_set).toEqual(['ZENODO_TOKEN']);
    const runbook = (out.result.runbook as string[]).join('\n');
    expect(runbook).toContain('ZENODO_TOKEN_SANDBOX');
    expect(runbook).toContain('CLOUDFLARE_API_TOKEN');
    expect(runbook).not.toContain('zt'); // never the value
  });

  it('the runbook says how to give an author push access, with the repo filled in [R124]', async () => {
    const { prov } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput(), deps(prov));
    expect((out.result.runbook as string[]).join('\n')).toContain(
      'gh api -X PUT repos/me/paper/collaborators/<github-user> -f permission=push',
    );
  });

  it('allows Actions to open pull requests, which the first DOI pull request needs [R122]', async () => {
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(paperInput(), deps(prov));
    expect(calls.allowActionsApprovePrs).toEqual(['me/paper']);
    expect((out.result.actions as Record<string, string>).actions_pull_requests).toBe('allowed');

    const already = fakeProv({ actionsCanApprovePrs: true });
    await cmdBootstrapPaper(paperInput(), deps(already.prov));
    expect(already.calls.allowActionsApprovePrs).toHaveLength(0); // read before changing
  });

  it('creates zenodo-publish with no required reviewer, for a team, a user or an org [R123]', async () => {
    const org = fakeProv({ ownerType: 'Organization' });
    await cmdBootstrapPaper(
      paperInput({ repo: 'org/paper', owner: '@org/editors' }),
      deps(org.prov),
    );
    expect(zenodoPuts(org.calls)).toEqual([{ r: 'org/paper', n: 'zenodo-publish', v: [] }]);

    const personal = fakeProv({ ownerType: 'User' });
    await cmdBootstrapPaper(paperInput(), deps(personal.prov));
    expect(zenodoPuts(personal.calls)).toEqual([{ r: 'me/paper', n: 'zenodo-publish', v: [] }]);

    const noTeam = fakeProv({ ownerType: 'Organization' });
    const out = await cmdBootstrapPaper(
      paperInput({ repo: 'org/paper', owner: '@org' }),
      deps(noTeam.prov),
    );
    expect(zenodoPuts(noTeam.calls)).toEqual([{ r: 'org/paper', n: 'zenodo-publish', v: [] }]);
    expect(out.result.status).toBe('ok');
  });

  it('a rerun keeps a zenodo-publish reviewer added by hand [R123]', async () => {
    const { prov, calls } = fakeProv({
      environments: new Set(['me/paper/zenodo-publish']),
      reviewers: [{ type: 'User', id: 12 }],
    });
    await cmdBootstrapPaper(paperInput(), deps(prov));
    expect(zenodoPuts(calls)).toHaveLength(0);
  });

  it('sets every secret on its environments and none as a repository secret', async () => {
    const { prov, calls } = fakeProv();
    const out = await cmdBootstrapPaper(
      paperInput({
        secrets: { zenodoToken: 'zt', zenodoTokenSandbox: 'zs', cfToken: 'ct', cfAccount: 'ca' },
      }),
      deps(prov),
    );
    expect(
      (calls.setSecret as Array<{ e: string; n: string }>).map((c) => `${c.e}/${c.n}`),
    ).toEqual([
      'zenodo-publish/ZENODO_TOKEN',
      'zenodo-prepare/ZENODO_TOKEN',
      'zenodo-publish/ZENODO_TOKEN_SANDBOX',
      'zenodo-prepare/ZENODO_TOKEN_SANDBOX',
      'preview/CLOUDFLARE_API_TOKEN',
      'preview/CLOUDFLARE_ACCOUNT_ID',
    ]);
    expect((out.result.runbook as string[]).join('\n')).not.toContain('settings/environments :');
  });

  it('creates zenodo-prepare and preview admitting main only', async () => {
    const { prov, calls } = fakeProv();
    await cmdBootstrapPaper(paperInput(), deps(prov));
    expect(calls.upsertEnvironment).toContainEqual({ r: 'me/paper', n: 'zenodo-prepare', v: [] });
    expect(calls.upsertEnvironment).toContainEqual({ r: 'me/paper', n: 'preview', v: [] });
    expect(calls.createBranchPolicy).toContainEqual({
      r: 'me/paper',
      e: 'zenodo-prepare',
      n: 'main',
      t: 'branch',
    });
    expect(calls.createBranchPolicy).toContainEqual({
      r: 'me/paper',
      e: 'preview',
      n: 'main',
      t: 'branch',
    });
  });

  it('restricts an environment GitHub auto-created, keeping its reviewers', async () => {
    // An upgraded workflow can name `preview` before bootstrap reruns. GitHub then creates it
    // open to every branch, and a branch policy cannot be added until that is switched off.
    const { prov, calls } = fakeProv({
      environments: new Set(['me/paper/preview', 'me/paper/zenodo-publish']),
      openEnvironments: new Set(['me/paper/preview', 'me/paper/zenodo-publish']),
      reviewers: [{ type: 'User', id: 12 }],
    });
    await cmdBootstrapPaper(paperInput(), deps(prov));
    for (const n of ['preview', 'zenodo-publish'])
      expect(calls.upsertEnvironment).toContainEqual({
        r: 'me/paper',
        n,
        v: [{ type: 'User', id: 12 }],
      });
    expect(calls.createBranchPolicy).toContainEqual({
      r: 'me/paper',
      e: 'preview',
      n: 'main',
      t: 'branch',
    });
  });

  it('deletes a repository secret once its environments all hold it', async () => {
    const { prov, calls } = fakeProv({
      secrets: new Set([
        'me/paper/ZENODO_TOKEN',
        'me/paper/CLOUDFLARE_API_TOKEN',
        'me/paper/CLOUDFLARE_ACCOUNT_ID',
        'me/paper/preview/CLOUDFLARE_ACCOUNT_ID', // set on an earlier run
      ]),
    });
    const out = await cmdBootstrapPaper(paperInput({ secrets: { zenodoToken: 'zt' } }), deps(prov));
    expect(calls.deleteRepoSecret).toEqual([
      { r: 'me/paper', n: 'ZENODO_TOKEN' },
      { r: 'me/paper', n: 'CLOUDFLARE_ACCOUNT_ID' },
    ]);
    // No value given and no environment copy: deleting it would lose the only one.
    const runbook = (out.result.runbook as string[]).join('\n');
    expect(runbook).toContain('CLOUDFLARE_API_TOKEN is still a repository secret');
    expect(runbook).not.toContain('CLOUDFLARE_ACCOUNT_ID is still');
  });

  it('creates the labels the workflows use, and no others [R127] [R128]', async () => {
    const { prov, calls } = fakeProv();
    await cmdBootstrapPaper(paperInput(), deps(prov));
    expect((calls.createLabel as Array<{ n: string }>).map((c) => c.n)).toEqual([
      LABEL_EDITOR_ACTION,
      LABEL_ZENODO_FAILED,
    ]);
  });

  it('makes main the default branch of an existing repo [R127]', async () => {
    const moved = fakeProv({ defaultBranch: 'master', repos: new Set(['me/paper']) });
    await cmdBootstrapPaper(paperInput(), deps(moved.prov));
    expect(moved.calls.setDefaultBranch).toEqual([{ r: 'me/paper', b: 'main' }]);

    const already = fakeProv();
    await cmdBootstrapPaper(paperInput(), deps(already.prov));
    expect(already.calls.setDefaultBranch).toHaveLength(0);
  });

  it('the merge rule is what protect-main says it is [R128]', async () => {
    const { prov, calls } = fakeProv();
    await cmdBootstrapPaper(paperInput(), deps(prov));
    const pm = (calls.createRuleset as Array<{ b: any }>).find(
      (c) => c.b.name === RULESET_PROTECT_MAIN,
    )!.b;
    const pr = pm.rules.find((r: any) => r.type === 'pull_request');
    expect(pr.parameters.require_code_owner_review).toBe(true);
    // Off, or the DOI pull request a bot opens would wait for a review nobody asked for.
    expect(pr.parameters.require_extra_approval_for_unattributed_changes).toBe(false);
    const checks = pm.rules.find((r: any) => r.type === 'required_status_checks');
    expect(checks.parameters.required_status_checks).toEqual([{ context: 'Journal checks' }]);
  });

  it('the v* tag rule stops a tag being moved or deleted, not only created [R128]', async () => {
    const { prov, calls } = fakeProv();
    await cmdBootstrapPaper(paperInput(), deps(prov));
    const vt = (calls.createRuleset as Array<{ b: any }>).find(
      (c) => c.b.name === RULESET_V_TAGS,
    )!.b;
    expect(vt.rules.map((r: any) => r.type).sort()).toEqual(['creation', 'deletion', 'update']);
  });

  it('a paper repo is public unless the editor asks otherwise [R128]', async () => {
    const open = fakeProv();
    await cmdBootstrapPaper(paperInput(), deps(open.prov));
    expect((open.calls.createRepo[0] as { o: { private: boolean } }).o.private).toBe(false);

    const closed = fakeProv();
    await cmdBootstrapPaper(paperInput({ private: true }), deps(closed.prov));
    expect((closed.calls.createRepo[0] as { o: { private: boolean } }).o.private).toBe(true);
  });

  it('a sole editor may merge their own gated pull request, and still cannot push to main [R127]', async () => {
    const personal = fakeProv({ ownerType: 'User' });
    await cmdBootstrapPaper(paperInput(), deps(personal.prov));
    const pm = (personal.calls.createRuleset as Array<{ b: any }>).find(
      (c) => c.b.name === RULESET_PROTECT_MAIN,
    )!.b;
    expect(pm.bypass_actors).toEqual([
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' },
    ]);

    // An org team's members review each other, so it gets no bypass on the merge rule.
    const org = fakeProv({ ownerType: 'Organization' });
    await cmdBootstrapPaper(
      paperInput({ repo: 'org/paper', owner: '@org/editors' }),
      deps(org.prov),
    );
    const orgPm = (org.calls.createRuleset as Array<{ b: any }>).find(
      (c) => c.b.name === RULESET_PROTECT_MAIN,
    )!.b;
    expect(orgPm.bypass_actors).toEqual([]);
  });

  it('an org grants the team and a team bypass; a personal account gets a repo admin bypass', async () => {
    const org = fakeProv({ ownerType: 'Organization' });
    await cmdBootstrapPaper(
      paperInput({ repo: 'org/paper', owner: '@org/editors' }),
      deps(org.prov),
    );
    expect(org.calls.grantTeamWrite).toHaveLength(1);
    const vTags = (org.calls.createRuleset as Array<{ b: any }>).find(
      (c) => c.b.name === RULESET_V_TAGS,
    )!.b;
    expect(vTags.bypass_actors[0].actor_type).toBe('Team');

    const personal = fakeProv({ ownerType: 'User' });
    await cmdBootstrapPaper(paperInput(), deps(personal.prov));
    expect(personal.calls.grantTeamWrite).toHaveLength(0);
    const vt2 = (personal.calls.createRuleset as Array<{ b: any }>).find(
      (c) => c.b.name === RULESET_V_TAGS,
    )!.b;
    expect(vt2.bypass_actors[0].actor_type).toBe('RepositoryRole');
    expect(vt2.bypass_actors[0].actor_id, 'GitHub id of the repository admin role').toBe(5);
  });
});

/* --------------------------------------------------------------------------
 * cmdBootstrapJournal
 * ------------------------------------------------------------------------ */

describe('cmdBootstrapJournal', () => {
  /** Journal bootstrap with a workdir we can inspect afterwards. */
  const journalDeps = (prov: Provisioner, seedDirs: string[]) => {
    const d = deps(prov);
    d.workdir = () => {
      const dir = tmp('oak-seed-');
      seedDirs.push(dir);
      return dir;
    };
    return d;
  };

  it("--external: a public repo with the journal's settings and website, Pages, no rulesets or environments", async () => {
    const { prov, calls } = fakeProv();
    const seedDirs: string[] = [];
    const out = await cmdBootstrapJournal(
      {
        repo: 'me/config',
        tier: 'external',
        name: 'J',
        edition: 'ed-2026',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        secrets: {},
      },
      journalDeps(prov, seedDirs),
    );
    expect((calls.createRepo[0] as { o: { private: boolean } }).o.private).toBe(false);
    expect(calls.seedBranch).toHaveLength(1);
    expect(calls.createRuleset).toHaveLength(0); // no rulesets: a journal repo has no branch rules
    expect(calls.enablePages).toHaveLength(1); // but the website needs Pages
    expect(out.result.tier).toBe('external');
    expect(out.result.site_url).toBe('https://me.github.io/config/');

    // The journal's settings and the website, in one repo.
    const seed = seedDirs[0]!;
    expect(existsSync(join(seed, 'journal.yml'))).toBe(true);
    expect(existsSync(join(seed, 'registry/papers.yml'))).toBe(true);
    expect(existsSync(join(seed, 'myst.yml'))).toBe(true);
    expect(existsSync(join(seed, 'pages/index.md'))).toBe(true);
    expect(existsSync(join(seed, '.github/workflows/site.yml'))).toBe(true);
    const myst = parseDocument(readFileSync(join(seed, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['site', 'template'])).toBe(themeZipUrl());
    expect(myst.getIn(['project', 'plugins', 0])).toBe(galleryPluginUrl('me/engine', 'v1'));
    expect(myst.getIn(['project', 'title'])).toBe('J');
    expect((out.result.runbook as string[]).join('\n')).not.toContain('collaborators');
    // Each paper's header links back to the website.
    const brand = parseDocument(readFileSync(join(seed, 'brand/brand.yml'), 'utf8'));
    expect(brand.getIn(['site', 'options', 'logo_url'])).toBe('https://me.github.io/config/');
  });

  it('--external <owner>.github.io: the brand links to the root site', async () => {
    const { prov } = fakeProv();
    const seedDirs: string[] = [];
    await cmdBootstrapJournal(
      {
        repo: 'Me/me.github.io',
        tier: 'external',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        secrets: {},
      },
      journalDeps(prov, seedDirs),
    );
    const brand = parseDocument(readFileSync(join(seedDirs[0]!, 'brand/brand.yml'), 'utf8'));
    expect(brand.getIn(['site', 'options', 'logo_url'])).toBe('https://me.github.io/');
  });

  it('--external --no-site: neither the site files nor Pages', async () => {
    const { prov, calls } = fakeProv();
    const seedDirs: string[] = [];
    const out = await cmdBootstrapJournal(
      {
        repo: 'me/config',
        tier: 'external',
        name: 'J',
        edition: 'ed-2026',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        site: false,
        secrets: {},
      },
      journalDeps(prov, seedDirs),
    );
    expect(calls.enablePages ?? []).toHaveLength(0);
    expect(out.result.site_url).toBeUndefined();
    const seed = seedDirs[0]!;
    const brand = parseDocument(readFileSync(join(seed, 'brand/brand.yml'), 'utf8'));
    expect(brand.getIn(['site', 'options', 'logo_url'])).toBeUndefined();
    expect(existsSync(join(seed, 'journal.yml'))).toBe(true);
    expect(existsSync(join(seed, 'myst.yml'))).toBe(false);
    expect(existsSync(join(seed, '.github'))).toBe(false);
  });

  it('an --external rerun does not enable Pages again', async () => {
    const { prov, calls } = fakeProv({
      repos: new Set(['me/config']),
      branches: new Set(['me/config/main']),
      pages: new Set(['me/config']),
    });
    await cmdBootstrapJournal(
      {
        repo: 'me/config',
        tier: 'external',
        edition: 'ed-2026',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        secrets: {},
      },
      deps(prov),
    );
    expect(calls.enablePages ?? []).toHaveLength(0);
  });

  it('an --external rerun makes a private repo public again', async () => {
    const { prov, calls } = fakeProv({
      repos: new Set(['me/config']),
      branches: new Set(['me/config/main']),
      visibility: 'private',
    });
    await cmdBootstrapJournal(
      {
        repo: 'me/config',
        tier: 'external',
        edition: 'ed-2026',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        secrets: {},
      },
      deps(prov),
    );
    expect(calls.setRepoPublic).toHaveLength(1);
  });

  it("--co-located: seeds the paper workflows, a starter paper and the journal's settings, and sets them up", async () => {
    const { prov, calls } = fakeProv();
    const seedDirs: string[] = [];
    const d = deps(prov);
    d.workdir = () => {
      const dir = tmp('oak-colo-');
      seedDirs.push(dir);
      return dir;
    };
    const out = await cmdBootstrapJournal(
      {
        repo: 'me/journal',
        tier: 'co-located',
        name: 'J',
        edition: 'ed-2026',
        engineVersion: 'v9',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        requireChecks: true,
        secrets: {},
      },
      d,
    );
    expect(calls.createRuleset).toHaveLength(2); // it builds a paper
    // The seed holds both the paper workflows and the journal's settings, with
    // `instance_repo: .` in pins.yml.
    const seed = seedDirs[0]!;
    expect(existsSync(join(seed, '.github/workflows/ci.yml'))).toBe(true);
    expect(existsSync(join(seed, 'myst.yml'))).toBe(true);
    expect(existsSync(join(seed, 'journal.yml'))).toBe(true);
    const pins = parseDocument(readFileSync(join(seed, '.github/actions/engine/pins.yml'), 'utf8'));
    expect(pins.get('instance_repo')).toBe('.');
    // No website: an index over papers in one repo is not built yet.
    expect(existsSync(join(seed, 'pages/index.md'))).toBe(false);
    expect(existsSync(join(seed, '.github/workflows/site.yml'))).toBe(false);
    expect(existsSync(join(seed, 'package.json'))).toBe(false);
    const myst = parseDocument(readFileSync(join(seed, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'options', 'oaktree-sapling', 'version'])).toBe('v9'); // the starter paper's
    expect(myst.getIn(['project', 'github'])).toBe('https://github.com/me/journal');
    const brand = parseDocument(readFileSync(join(seed, 'brand/brand.yml'), 'utf8'));
    expect(brand.getIn(['site', 'options', 'logo_text'])).toBe('J');
    expect(brand.getIn(['site', 'options', 'logo_url'])).toBeUndefined(); // no website
    expect((out.result.runbook as string[])[0]).toMatch(/^Next: /);
  });

  it('a default --edition is shown, with the file it will write', async () => {
    // A journal may default the edition, since the same value names the editions/<id>.yml
    // this run writes. The plan still says so, because every paper repeats that id.
    const { prov } = fakeProv();
    const seedDirs: string[] = [];
    const plans: string[][] = [];
    const d = journalDeps(prov, seedDirs);
    d.confirm = async (plan) => {
      plans.push(plan);
      return true;
    };
    await cmdBootstrapJournal(
      {
        repo: 'me/config',
        tier: 'external',
        name: 'J',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        requireChecks: true,
        secrets: {},
        resolved: { engineVersionFrom: 'flag', engineRepoFrom: 'default' },
      },
      d,
    );
    const plan = plans[0]!.join('\n');
    expect(plan).toMatch(/edition        : edition \(placeholder; no --edition given\)/);
    expect(plan).toContain('editions/edition.yml');
    expect(existsSync(join(seedDirs[0]!, 'editions/edition.yml'))).toBe(true);
  });

  it('the plan shows no review owner for an external journal, which has none', async () => {
    // An external journal repo gets no CODEOWNERS and no team grant, so the plan shows no
    // owner.
    const { prov } = fakeProv();
    const plans: string[][] = [];
    const ext = journalDeps(prov, []);
    ext.confirm = async (plan) => {
      plans.push(plan);
      return false;
    };
    await cmdBootstrapJournal(
      {
        repo: 'me/config',
        tier: 'external',
        name: 'J',
        edition: 'ed',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        requireChecks: true,
        secrets: {},
      },
      ext,
    );
    expect(plans[0]!.join('\n')).not.toContain('review owner');

    // A co-located journal writes CODEOWNERS, so the plan shows the owner.
    const colo = journalDeps(fakeProv().prov, []);
    colo.confirm = async (plan) => {
      plans.push(plan);
      return false;
    };
    await cmdBootstrapJournal(
      {
        repo: 'me/journal',
        tier: 'co-located',
        name: 'J',
        edition: 'ed',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        requireChecks: true,
        secrets: {},
      },
      colo,
    );
    expect(plans[1]!.join('\n')).toContain('review owner   : @alice');
  });

  it('--co-located --no-site is refused', async () => {
    const { prov } = fakeProv();
    const out = await cmdBootstrapJournal(
      {
        repo: 'me/journal',
        tier: 'co-located',
        site: false,
        name: 'J',
        edition: 'ed',
        engineVersion: 'v9',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        requireChecks: true,
        secrets: {},
      },
      journalDeps(prov, []),
    );
    // A co-located journal has no website, so --no-site is refused with the reason.
    expect(out.exitCode).toBe(2);
    expect(out.result.status).toBe('error');
    expect(String(out.result.error)).toContain('--external');
  });
});

describe("buildReviewTree drops the author's files under the editor's paths [R121]", () => {
  it('drops an author .github path that main does not have', () => {
    // Here main lacks the author's path, so restoring main's `.github/` would not cover it.
    const tree = buildReviewTree(
      { 'index.md': 'a', '.github/workflows/evil.yml': 'on: push' },
      { '.github/workflows/ci.yml': 'frozen' },
    );
    expect(Object.keys(tree).sort()).toEqual(['.github/workflows/ci.yml', 'index.md']);
  });
});

/* --------------------------------------------------------------------------
 * A failed step is recorded, not thrown ([R125])
 * ------------------------------------------------------------------------ */

describe('a failing setup step [R125]', () => {
  it('a settings failure is recorded, the other settings still run, and the run reports incomplete', async () => {
    // A 403 on the first ruleset is recorded, and the remaining settings are still tried.
    const { prov, calls } = fakeProv();
    prov.createRuleset = () => {
      throw new Error('gh api failed (exit 1): 403 rulesets are not available on private repos');
    };
    const out = await cmdBootstrapPaper(paperInput(), deps(prov));
    expect(out.exitCode).toBe(1);
    expect(out.result.status).toBe('incomplete');
    const actions = out.result.actions as Record<string, string>;
    expect(actions.repo).toBe('created');
    expect(actions.main).toBe('seeded');
    expect(actions.protect_main).toMatch(/^failed: .*403/);
    expect(actions.v_tags).toMatch(/^failed: /);
    // Independent steps are all attempted.
    expect(actions.pages).toBe('enabled');
    expect(calls.enablePages).toHaveLength(1);
    expect(calls.createLabel).toHaveLength(2);
    expect((out.result.failed as string[]).join('\n')).toContain('protect_main');
    const runbook = (out.result.runbook as string[]).join('\n');
    expect(runbook).toContain('protect_main');
    expect(runbook).toContain('re-run');
  });

  it('a repo that cannot be created stops the run, with the usual result and no stack', async () => {
    const { prov, calls } = fakeProv();
    prov.createRepo = () => {
      throw new Error('gh repo create failed (exit 1): 403 name already taken');
    };
    const out = await cmdBootstrapPaper(paperInput(), deps(prov));
    expect(out.exitCode).toBe(1);
    expect(out.result.status).toBe('incomplete');
    expect((out.result.actions as Record<string, string>).repo).toMatch(/^failed: /);
    // Nothing downstream can act on a repo that does not exist.
    expect(calls.seedBranch).toHaveLength(0);
    expect(calls.createRuleset).toHaveLength(0);
  });

  it('a failed seed skips the --from steps, and the settings are still applied', async () => {
    const { prov, calls } = fakeProv();
    prov.seedBranch = () => {
      throw new Error('git push failed (exit 1): remote hung up');
    };
    const out = await cmdBootstrapPaper(paperInput({ from: 'https://github.com/a/b' }), deps(prov));
    expect(out.result.status).toBe('incomplete');
    // Without main there is no `.github/` to restore and no base for the pull request.
    expect(calls.ingestReviewBranch).toHaveLength(0);
    expect(calls.openPr).toHaveLength(0);
    expect(calls.createRuleset).toHaveLength(2);
    expect((out.result.actions as Record<string, string>).main).toMatch(/^failed: /);
  });

  it('a secret gh refuses goes in the by-hand list; the others are still set', async () => {
    const { prov } = fakeProv();
    const setCalls: string[] = [];
    prov.setSecret = (_r, env, name) => {
      setCalls.push(`${env}/${name}`);
      if (name === 'ZENODO_TOKEN' && env === 'zenodo-prepare')
        throw new Error('gh secret set failed (exit 1): resource not accessible');
    };
    const out = await cmdBootstrapPaper(
      paperInput({ secrets: { zenodoToken: 'zt', cfToken: 'ct' } }),
      deps(prov),
    );
    expect(setCalls).toEqual([
      'zenodo-publish/ZENODO_TOKEN',
      'zenodo-prepare/ZENODO_TOKEN',
      'preview/CLOUDFLARE_API_TOKEN',
    ]); // the loop carried on
    expect(out.result.secrets_set).toEqual(['CLOUDFLARE_API_TOKEN']);
    // Parses the by-hand list itself: the step-failure line names the secret too, and
    // ZENODO_TOKEN is a substring of ZENODO_TOKEN_SANDBOX, so a looser match would pass
    // without it.
    const byHand = (out.result.runbook as string[]).find((l) =>
      l.includes('settings/environments :'),
    );
    const byHandEntries = byHand!.split(' : ')[1]!.split('. ')[0]!.split('; ');
    expect(byHandEntries).toContain('ZENODO_TOKEN (zenodo-prepare)'); // only where it failed
    expect(byHandEntries.map((e) => e.split(' ')[0])).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(out.result.status).toBe('incomplete');
  });

  it('an external journal reports a failed Pages step the same way', async () => {
    const { prov } = fakeProv();
    prov.enablePages = () => {
      throw new Error('gh api failed (exit 1): 403');
    };
    const out = await cmdBootstrapJournal(
      {
        repo: 'me/config',
        tier: 'external',
        name: 'J',
        edition: 'ed-2026',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        secrets: {},
      },
      deps(prov),
    );
    expect(out.exitCode).toBe(1);
    expect(out.result.status).toBe('incomplete');
    expect((out.result.actions as Record<string, string>).pages).toMatch(/^failed: /);
    expect(out.result.site_url).toBeTruthy();
    expect((out.result.runbook as string[]).join('\n')).toContain("'pages'");
  });

  it('a co-located journal: a failed setting still seeds main and reports incomplete', async () => {
    const { prov, calls } = fakeProv();
    prov.createRuleset = () => {
      throw new Error('gh api failed (exit 1): 403');
    };
    const out = await cmdBootstrapJournal(
      {
        repo: 'me/journal',
        tier: 'co-located',
        name: 'J',
        edition: 'ed-2026',
        engineVersion: 'v1',
        engineRepo: 'me/engine',
        authedUser: 'alice',
        requireChecks: true,
        secrets: {},
      },
      deps(prov),
    );
    expect(calls.seedBranch).toHaveLength(1);
    expect(out.result.status).toBe('incomplete');
    expect((out.result.actions as Record<string, string>).protect_main).toMatch(/^failed: /);
  });

  it('an existing zenodo-publish environment is left alone [R127]', async () => {
    // The PUT replaces the whole environment, so a rerun sends no PUT and keeps what the
    // journal set by hand.
    const { prov, calls } = fakeProv({
      ownerType: 'Organization',
      environments: new Set(['org/paper/zenodo-publish']),
    });
    const out = await cmdBootstrapPaper(
      paperInput({ repo: 'org/paper', owner: '@org' }),
      deps(prov),
    );
    expect(zenodoPuts(calls)).toHaveLength(0);
    expect(out.result.status).toBe('ok');
  });

  it('--private warns in the plan that the settings steps need a paid plan [R127]', async () => {
    const { prov } = fakeProv();
    const plans: string[][] = [];
    const d = deps(prov);
    d.confirm = async (plan) => {
      plans.push(plan);
      return false;
    };
    await cmdBootstrapPaper(paperInput({ private: true }), d);
    const plan = plans[0]!.join('\n');
    expect(plan).toContain('403');
    expect(plan).toContain('rulesets or Pages');
    // The warning is tied to the flag, not printed on every plan.
    await cmdBootstrapPaper(paperInput(), d);
    expect(plans[1]!.join('\n')).not.toContain('free plan');
  });
});
