import { describe, it, expect } from 'vitest';
import { compose, type ComposeInput, type ResolvedProject } from '../src/compose.js';
import { typstTemplateUrl, themeZipUrl } from '../src/assets.js';

const ENGINE = '.engine';
const INSTANCE = '.instance';
const ENGINE_REPO = 'open-scholar-nexus/oaktree-sapling';
const VERSION = 'v0.3.0';
const EDITION = 'fixture-edition';

/** What loadConfig().project returns after `extends` resolves paper-base and the edition: the
 *  typst export has `articles` (from the edition) and no template, since the edition sets none.
 *  Plus the author's `youtube` option. */
const resolvedProject: ResolvedProject = {
  id: 'fixture-2026-sample-paper',
  title: 'A Fixture Paper',
  options: {
    youtube: 'https://youtu.be/x',
    'oaktree-sapling': { version: VERSION, edition: EDITION },
  },
  exports: [{ id: 'typst-pdf', format: 'typst', articles: [{ file: 'index.md', level: 0 }] }],
};

const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  paperRoot: '.',
  engineRoot: ENGINE,
  instanceRoot: INSTANCE,
  resolvedProject,
  engineRepo: ENGINE_REPO,
  engineVersion: VERSION,
  edition: EDITION,
  baseUrl: '/fixture-sample-paper',
  ...over,
});

describe('compose: extends chain', () => {
  it('chains paper-base, then the edition, then the brand [R52]', () => {
    const r = compose(base());
    expect(r.extendsChain).toEqual([
      `${ENGINE}/paper-base.yml`,
      `${INSTANCE}/editions/${EDITION}.yml`,
      `${INSTANCE}/brand/brand.yml`,
    ]);
  });

  it('--no-instance builds unbranded, with only paper-base and a warning', () => {
    const r = compose(base({ instanceRoot: null }));
    expect(r.extendsChain).toEqual([`${ENGINE}/paper-base.yml`]);
    expect(r.warnings.join(' ')).toMatch(/no-instance/);
  });
});

describe("compose: what oak sets on the paper's own config [R5] [R52]", () => {
  it('writes the whole typst entry, articles and template', () => {
    const r = compose(base());
    const exp = r.ownOverride.project!.exports[0]!;
    expect(exp.template).toBe(typstTemplateUrl(ENGINE_REPO, VERSION));
    expect(exp.articles).toEqual([{ file: 'index.md', level: 0 }]); // kept, since entries are not merged field by field
    expect(exp.id).toBe('typst-pdf');
  });

  it('sets the version-matched theme zip as site.template', () => {
    const r = compose(base());
    expect(r.ownOverride.site!.template).toBe(themeZipUrl());
  });

  it('warns, without throwing, when the resolved config has no typst export', () => {
    const r = compose(base({ resolvedProject: { ...resolvedProject, exports: [] } }));
    expect(r.ownOverride.project).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/no typst export/);
  });
});

describe('compose: brand paths made absolute [R62]', () => {
  const brandAssets = {
    site: {
      logo: './logo.svg',
      favicon: 'favicon.svg', // a relative path without ./ is made absolute too
      logo_dark: 'https://cdn.example.org/logo-dark.svg', // a URL is left alone
      style: '/already/absolute.css', // an absolute path is left alone
    },
    project: {
      logo: './logo-watermark.svg', // typst watermark → project.options.logo
    },
  };

  it('rewrites relative site paths to <instanceRoot>/brand/<x>', () => {
    const r = compose(base({ brandAssets }));
    expect(r.ownOverride.site!.options).toMatchObject({
      logo: `${INSTANCE}/brand/logo.svg`,
      favicon: `${INSTANCE}/brand/favicon.svg`,
    });
  });

  it('puts the typst watermark in project.options.logo, as an absolute path', () => {
    const r = compose(base({ brandAssets }));
    expect(r.ownOverride.project!.options!.logo).toBe(`${INSTANCE}/brand/logo-watermark.svg`);
    // and it sits beside the typst export entry, not replacing it
    expect(r.ownOverride.project!.exports![0]!.id).toBe('typst-pdf');
  });

  it('leaves URLs and absolute paths alone', () => {
    const r = compose(base({ brandAssets }));
    expect(r.ownOverride.site!.options!.logo_dark).toBe('https://cdn.example.org/logo-dark.svg');
    expect(r.ownOverride.site!.options!.style).toBe('/already/absolute.css');
  });

  it("keeps the theme's site.template beside the asset options", () => {
    const r = compose(base({ brandAssets }));
    expect(r.ownOverride.site!.template).toBe(themeZipUrl());
  });

  it('sets asset options without a theme too (siteTemplate: null)', () => {
    const r = compose(base({ brandAssets, assetOverrides: { siteTemplate: null } }));
    expect(r.ownOverride.site!.template).toBeUndefined();
    expect(r.ownOverride.site!.options!.logo).toBe(`${INSTANCE}/brand/logo.svg`);
  });

  it('sets no asset options without brandAssets (only the template and typst export)', () => {
    const r = compose(base());
    expect(r.ownOverride.site!.options).toBeUndefined();
    expect(r.ownOverride.project!.options).toBeUndefined();
  });

  it('--no-instance sets no asset options', () => {
    const r = compose(base({ instanceRoot: null, brandAssets }));
    expect(r.ownOverride.site?.options).toBeUndefined();
    expect(r.ownOverride.project?.options).toBeUndefined();
  });
});

describe("compose: the paper's other options are kept", () => {
  it('ownOverride sets only exports and site.template, never project.options', () => {
    const r = compose(base());
    expect(r.ownOverride.project).toEqual({
      exports: [expect.objectContaining({ id: 'typst-pdf' })],
    });
    expect(r.ownOverride.project).not.toHaveProperty('options');
  });
});

describe('compose: which typst template wins: author, then journal, then oak [R76]', () => {
  const ENGINE_LOCAL = `${ENGINE}/templates/typst`;
  /** A paper with its own template: the only way the resolved export has a `template:`, since
   *  paper-base and editions never set one. */
  const withAuthorTemplate = (template: string): ResolvedProject => ({
    ...resolvedProject,
    exports: [{ ...resolvedProject.exports![0]!, template }],
  });
  const templateOf = (r: ReturnType<typeof compose>) =>
    r.ownOverride.project!.exports![0]!.template;

  it("uses oak's release URL when nothing else is set", () => {
    expect(templateOf(compose(base()))).toBe(typstTemplateUrl(ENGINE_REPO, VERSION));
  });

  it("falls back to the template in oak's checkout last", () => {
    const r = compose(base({ assetOverrides: { engineTypstTemplate: ENGINE_LOCAL } }));
    expect(templateOf(r)).toBe(ENGINE_LOCAL);
  });

  it("the journal's template wins over oak's", () => {
    const r = compose(
      base({
        journalTypstTemplate: './typst-template',
        assetOverrides: { engineTypstTemplate: ENGINE_LOCAL },
      }),
    );
    expect(templateOf(r)).toBe(`${INSTANCE}/typst-template`);
  });

  it("the author's template wins over the journal's, with a warning", () => {
    const r = compose(
      base({
        resolvedProject: withAuthorTemplate('./my-template'),
        journalTypstTemplate: './typst-template',
        assetOverrides: { engineTypstTemplate: ENGINE_LOCAL },
      }),
    );
    expect(templateOf(r)).toBe('./my-template');
    expect(r.warnings.join(' ')).toMatch(/author template overrides the journal's/);
  });

  it("the author's template, with no journal template, wins without a warning", () => {
    const r = compose(base({ resolvedProject: withAuthorTemplate('./my-template') }));
    expect(templateOf(r)).toBe('./my-template');
    expect(r.warnings.join(' ')).not.toMatch(/overrides/);
  });

  it('--typst-template wins over all, with no override warning', () => {
    const r = compose(
      base({
        resolvedProject: withAuthorTemplate('./my-template'),
        journalTypstTemplate: './typst-template',
        assetOverrides: { typstTemplate: '/explicit/override', engineTypstTemplate: ENGINE_LOCAL },
      }),
    );
    expect(templateOf(r)).toBe('/explicit/override');
    expect(r.warnings.join(' ')).not.toMatch(/overrides/);
  });

  it('keeps an unpinned author template', () => {
    const floating = 'https://github.com/o/isp-lapreprint-typst.git';
    const r = compose(base({ resolvedProject: withAuthorTemplate(floating) }));
    expect(templateOf(r)).toBe(floating); // validate warns about it; compose keeps it
  });

  describe("the journal's value: only ./ and ../ are paths in the journal repo", () => {
    const journal = (v: string) => templateOf(compose(base({ journalTypstTemplate: v })));

    it("resolves ./ and ../ against the journal repo's root, where journal.yml is", () => {
      expect(journal('./typst-template')).toBe(`${INSTANCE}/typst-template`);
      // join() normalises, so `../` leaves the journal repo's root as written
      expect(journal('../shared/typst')).toBe('shared/typst');
    });

    it('leaves a myst template name alone', () => {
      expect(journal('lapreprint-typst')).toBe('lapreprint-typst');
      expect(journal('myst/lapreprint-typst')).toBe('myst/lapreprint-typst');
    });

    it('leaves URLs and absolute paths alone', () => {
      expect(journal('https://example.org/t.zip')).toBe('https://example.org/t.zip');
      expect(journal('/srv/typst-template')).toBe('/srv/typst-template');
    });

    it('leaves the value alone without a journal repo (--no-instance)', () => {
      const r = compose(base({ instanceRoot: null, journalTypstTemplate: './typst-template' }));
      expect(templateOf(r)).toBe('./typst-template');
    });
  });
});

describe('compose: BASE_URL [design §12a]', () => {
  it('passes /<repo> in CI and "" locally', () => {
    expect(compose(base({ baseUrl: '/fixture-sample-paper' })).env.BASE_URL).toBe(
      '/fixture-sample-paper',
    );
    expect(compose(base({ baseUrl: '' })).env.BASE_URL).toBe('');
  });
});

describe('compose: the version key read from myst.yml and after extends must agree [R36]', () => {
  it('throws when an extended config overrides project.options.oaktree-sapling', () => {
    const skewed: ResolvedProject = {
      ...resolvedProject,
      options: { 'oaktree-sapling': { version: 'v9.9.9', edition: EDITION } },
    };
    expect(() => compose(base({ resolvedProject: skewed }))).toThrow(/mismatch/);
  });
});
