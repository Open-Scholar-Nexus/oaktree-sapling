/**
 * Works out what a paper's build needs beyond its own config: the `extends:` chain
 * (local paths, no network) and the additions matched to the oak version. It is pure: reading
 * config, writing files and building happen at the CLI edge, so tests need no toolchain.
 *
 * MyST merges `exports` by id, whole entries only, and the base config wins [R52]. The derived
 * config's base is predictable, while the order between `extends:` entries is not, since they
 * load in parallel. So compose's additions go into the base as `ownOverride`, and its typst
 * export is complete: the edition's `articles` plus oak's `template:`.
 *
 * The CLI runs it in two passes: write the chain and resolve the project, then write
 * `ownOverride` over it and build. Neither write is committed.
 */
import * as msg from './messages.js';
import { isAbsolute, join } from 'node:path';
import { readEngineOptions } from './schema.js';
import { typstTemplateUrl, themeZipUrl } from './assets.js';

/**
 * Where the typst PDF is written, relative to the paper root. Without it, myst derives the path
 * from the file that declares the export, here the derived config, so renaming that file moved
 * every paper's PDF. The extension matters: with one, myst treats the value as the file; without,
 * as a folder, and a multi-article export would still be named after the config.
 */
export const TYPST_OUTPUT = '_build/exports/paper.pdf';

/** Brand fields holding a path, which myst resolves against the paper root rather than the
 *  brand directory [R62], so compose makes them absolute against `<instanceRoot>/brand`. By
 *  namespace: `site.options.*` for the HTML theme (logo, logo_dark, favicon, style), and
 *  `project.options.logo` for the PDF watermark, which oak's template has no default for. One
 *  definition, so yaml-io and compose agree. */
export const BRAND_ASSET_KEYS = {
  site: ['logo', 'logo_dark', 'favicon', 'style'],
  project: ['logo'],
} as const;

/** A value myst resolves on its own: an absolute path or a URL. Only paths relative to the
 *  journal repo need rewriting. A URL works for HTML but not for typst, which cannot
 *  fetch; `oak validate` is the place to check that. */
export function isBrandAssetUrl(value: string): boolean {
  return /^[a-zA-Z][\w+.-]*:\/\//.test(value); // matches scheme://…
}

/**
 * Whether a journal's `typst_template:` is a path in the journal repo, rather than a myst
 * template name or a URL [R74]. A bare string is ambiguous (`lapreprint-typst` is both a valid
 * name and a valid directory), and the brand-asset rule would take it for a path, so this rule is
 * explicit: only a `./` or `../` value is a path, and everything else goes to myst unchanged.
 * Checking the disk instead would turn a mistyped path into a name lookup. `oak validate` warns
 * when a bare value matches a directory in the journal repo.
 */
export function isInstanceRelativeTemplate(value: string): boolean {
  return /^\.\.?\//.test(value);
}

/** Makes a journal's template path absolute against the journal repo root, where
 *  `journal.yml` lives (brand assets use `brand/`). Only `./` and `../` values change; see
 *  {@link isInstanceRelativeTemplate}. Exported so `oak validate` checks the path compose emits
 *  [R62]. */
export function resolveTenantTemplate(instanceRoot: string, value: string): string {
  return isInstanceRelativeTemplate(value) ? join(instanceRoot, value) : value;
}

function needsAbsolutizing(value: string): boolean {
  if (isAbsolute(value)) return false;
  return !isBrandAssetUrl(value);
}

/** Resolves one brand asset as compose does: a relative value against `<instanceRoot>/brand/`,
 *  URLs and absolute paths as they are. Exported so `oak validate` checks the path compose emits
 *  [R62]. */
export function resolveBrandAssetPath(instanceRoot: string, value: string): string {
  return needsAbsolutizing(value) ? join(instanceRoot, 'brand', value.replace(/^\.\//, '')) : value;
}

/** Makes the relative values in `raw` (one namespace of {@link BRAND_ASSET_KEYS}) absolute
 *  against `<instanceRoot>/brand`. */
function absolutizeBrandAssets(
  instanceRoot: string,
  raw: Record<string, string> | undefined,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value !== 'string' || !value) continue;
    out[key] = resolveBrandAssetPath(instanceRoot, value);
  }
  return out;
}

/** The fields compose reads from the project myst resolved, by myst's own names [R185]. */
export interface ResolvedProject {
  id?: string;
  title?: string;
  options?: Record<string, unknown>;
  exports?: Array<Record<string, unknown>>;
  /** The gallery card's image, set by `paper-base.yml`. myst resolves it against the paper's
   *  source file, so unlike brand assets it needs no rewriting [R62]; `oak validate` checks it. */
  thumbnail?: string;
}

export interface ComposeInput {
  /** Path to the paper root, which holds myst.yml. */
  paperRoot: string;
  /** Path to oak's checkout, which holds paper-base.yml. */
  engineRoot: string;
  /** Path to the journal repo; null with --no-instance. */
  instanceRoot: string | null;
  /** The project as myst resolved it (`loadConfig().project`). Read only. */
  resolvedProject: ResolvedProject;
  /** oak's version and repo, read before the merge; used for URLs. */
  engineRepo: string;
  engineVersion: string;
  /** The paper's edition, read before the merge; selects `editions/<edition>.yml`. */
  edition: string;
  /** `/<repo>` in CI for GitHub Pages; empty locally and for previews [design §12a]. */
  baseUrl: string;
  /** Overrides for the asset URLs. By default they point at the release's zips; checkouts and
   *  tests pass local paths. */
  assetOverrides?: {
    /** `--typst-template <path>`: an explicit override, above every other template. */
    typstTemplate?: string;
    /** oak's own template as a local directory (`<engineRoot>/templates/typst`), the default
     *  that journal and author templates outrank. When absent, the release zip URL. */
    engineTypstTemplate?: string;
    /** string → use it; null → omit site.template (myst default); undefined → release zip. */
    siteTemplate?: string | null;
  };
  /** The journal's `typst_template:`, read as written from `journal.yml` [R68]. It cannot be an
   *  `exports[].template` in an `extends:` layer: a second layer declaring `exports:` makes the
   *  merge unpredictable [R72], so paper-base stays the only one. A name, path or URL; a `./`
   *  path is made absolute ({@link resolveTenantTemplate}). */
  tenantTypstTemplate?: string;
  /** The brand's asset fields ({@link BRAND_ASSET_KEYS}), read as written from
   *  `brand/brand.yml`. compose makes relative values absolute against `<instanceRoot>/brand`,
   *  since myst resolves them against the paper root [R62]. Read from brand.yml itself so a
   *  paper's own relative asset is never taken for the brand's. */
  brandAssets?: { site?: Record<string, string>; project?: Record<string, string> };
}

export interface OwnOverride {
  /** Merged into the base `project`. `options` carries only the PDF watermark (`logo`), set key
   *  by key so the author's other options survive. */
  project?: { exports?: Array<Record<string, unknown>>; options?: Record<string, string> };
  /** Merged into the base `site`. `options` carries the asset overrides [R62]; MyST merges
   *  `site.options` field by field, so the brand's other options survive. */
  site?: { template?: string; options?: Record<string, string> };
}

export interface ComposeResult {
  /** The `extends:` entries, as local paths, in order. */
  extendsChain: string[];
  /** oak's additions, merged into the base config, which wins over the chain [R52]. */
  ownOverride: OwnOverride;
  /** Environment for the build: MyST reads BASE_URL from the environment only. */
  env: { BASE_URL: string };
  warnings: string[];
}

/** The `extends:` chain, from the repo layout alone, so the two-pass build can write it
 *  before anything is resolved [design §12a] [R52]. Warns without a journal.
 *
 *  It is always a paper's chain: the journal website is a plain MyST project with its own
 *  config, and oak never builds it [R80]. */
export function extendsChainFor(input: {
  engineRoot: string;
  instanceRoot: string | null;
  edition: string;
}): { extendsChain: string[]; warnings: string[] } {
  const { engineRoot, instanceRoot, edition } = input;
  const warnings: string[] = [];
  const extendsChain: string[] = [`${engineRoot}/paper-base.yml`];
  if (instanceRoot === null) {
    warnings.push(
      '--no-instance: building unbranded (no edition/brand). Not CI-faithful; ' +
        'brand assets (logo, watermark) and edition frontmatter are absent.',
    );
  } else {
    extendsChain.push(`${instanceRoot}/editions/${edition}.yml`);
    extendsChain.push(`${instanceRoot}/brand/brand.yml`);
  }
  return { extendsChain, warnings };
}

export function compose(input: ComposeInput): ComposeResult {
  const {
    engineRoot,
    instanceRoot,
    resolvedProject,
    engineRepo,
    engineVersion,
    edition,
    baseUrl,
    assetOverrides = {},
  } = input;

  // The engine action reads the version and edition before the merge, the CLI after it; an
  // edition config declaring `project.options` could make them differ [R36].
  const resolved = readEngineOptions(resolvedProject.options);
  if (resolved.version !== engineVersion || resolved.edition !== edition) {
    throw new Error(
      msg.build.coordinateMismatch(engineVersion, edition, resolved.version, resolved.edition),
    );
  }

  const { extendsChain, warnings } = extendsChainFor({ engineRoot, instanceRoot, edition });

  // ownOverride: oak's additions to the base config [R52].
  const ownOverride: OwnOverride = {};

  // Typst export: set `output:` and `template:` (precedence below [R76]). MyST merges exports
  // whole, so the entry is complete: the resolved export (with the edition's `articles`) plus
  // both fields. Declaring them in paper-base would let a multi-article paper's own entry drop
  // them [R52] [R53].
  const typst = (resolvedProject.exports ?? []).find(
    (e) => e['format'] === 'typst' || e['id'] === 'typst-pdf',
  );
  if (typst) {
    // Template precedence [R76]: author, then journal, then oak. A `template:` on the resolved
    // export can only be the author's, since paper-base and editions declare none [R72]. It is
    // honoured whatever it is; `oak validate` warns when it floats [R5], and the deposit keeps
    // the resolved template, so a DOI stays reproducible.
    const authorTemplate =
      typeof typst['template'] === 'string' && typst['template']
        ? (typst['template'] as string)
        : undefined;
    const tenantTemplate =
      input.tenantTypstTemplate && instanceRoot
        ? resolveTenantTemplate(instanceRoot, input.tenantTypstTemplate)
        : input.tenantTypstTemplate;
    const engineTemplate =
      assetOverrides.engineTypstTemplate ?? typstTemplateUrl(engineRepo, engineVersion);
    const template =
      assetOverrides.typstTemplate ?? authorTemplate ?? tenantTemplate ?? engineTemplate;

    // A paper overriding the journal's template is allowed, but must show in the pull request;
    // `oak validate` reports it there too.
    if (authorTemplate && tenantTemplate && !assetOverrides.typstTemplate) {
      warnings.push(
        `author template overrides the journal's: this paper declares its own typst ` +
          `template ("${authorTemplate}") in place of the journal's ("${input.tenantTypstTemplate}").`,
      );
    }

    ownOverride.project = { exports: [{ ...typst, template, output: TYPST_OUTPUT }] };
  } else {
    warnings.push(
      'no typst export found in the resolved config; PDF export + Zenodo deposit will be skipped',
    );
  }

  // The pinned book-theme fork zip [design §7]. `siteTemplate: null` leaves MyST's default theme.
  const site: NonNullable<OwnOverride['site']> = {};
  const siteTemplate =
    assetOverrides.siteTemplate === undefined ? themeZipUrl() : assetOverrides.siteTemplate;
  if (siteTemplate !== null) {
    site.template = siteTemplate;
  }

  // Brand assets [R62]: relative values made absolute against `brand/`, since MyST resolves them
  // against the paper root, where the journal's files are not. HTML assets go in site.options,
  // the PDF watermark in project.options.logo.
  if (instanceRoot && input.brandAssets) {
    const siteOptions = absolutizeBrandAssets(
      instanceRoot,
      input.brandAssets.site,
      BRAND_ASSET_KEYS.site,
    );
    if (Object.keys(siteOptions).length) site.options = siteOptions;

    const projectOptions = absolutizeBrandAssets(
      instanceRoot,
      input.brandAssets.project,
      BRAND_ASSET_KEYS.project,
    );
    if (Object.keys(projectOptions).length) {
      ownOverride.project = { ...ownOverride.project, options: projectOptions };
    }
  }

  if (site.template !== undefined || site.options) ownOverride.site = site;

  return {
    extendsChain,
    ownOverride,
    env: { BASE_URL: baseUrl },
    warnings,
  };
}
