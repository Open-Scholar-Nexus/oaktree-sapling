/**
 * Works out what a paper's build needs beyond its own config: the `extends:` chain
 * (local paths, no network) and the additions matched to the oak version. It is pure: reading
 * config, writing files and building happen at the CLI edge, so tests need no toolchain.
 *
 * MyST merges `exports` by id, whole entries only, and the base config wins [R52]. Entries in
 * `extends:` load in parallel, so their order is unpredictable. compose's additions therefore go
 * into the base as `ownOverride`, and its typst export is complete: the edition's `articles`
 * plus oak's `template:`.
 */
import * as msg from './messages.js';
import { isAbsolute, join } from 'node:path';
import { readEngineOptions, type JournalStamp } from './schema.js';
import { engineTypstTemplate, themeZipUrl } from './assets.js';

/**
 * Where the typst PDF is written, relative to the paper root. It is set so the PDF path does not
 * depend on the config file's name. The value has an extension, so
 * myst treats it as the output file; an extensionless value is a folder, and a multi-article
 * export would then be named after the config file.
 */
export const TYPST_OUTPUT = '_build/exports/paper.pdf';

/** The id of the typst export `paper-base.yml` declares, which the PDF download points at. */
export const TYPST_EXPORT_ID = 'typst-pdf';

/** Brand fields holding a path. They are written relative to the journal repo root, where myst
 *  resolves them on the journal website; compose makes them absolute against `<instanceRoot>`
 *  for a paper, whose root is elsewhere [R62]. `site.options.*` holds the HTML theme fields
 *  (logo, logo_dark, favicon, style); `project.options.logo` is the PDF watermark, which oak's
 *  template has no default for. yaml-io and compose share this list. */
export const BRAND_ASSET_KEYS = {
  site: ['logo', 'logo_dark', 'favicon', 'style'],
  project: ['logo'],
} as const;

/** A value myst resolves on its own: an absolute path or a URL. Only paths relative to the
 *  journal repo need rewriting. A URL works for HTML but not for typst, which cannot
 *  fetch; `oak validate` reports that. */
export function isBrandAssetUrl(value: string): boolean {
  return /^[a-zA-Z][\w+.-]*:\/\//.test(value); // matches scheme://…
}

/**
 * Whether a journal's `typst_template:` is a path in the journal repo, rather than a myst
 * template name or a URL [R76]. A bare string is ambiguous (`lapreprint-typst` is both a valid
 * name and a valid directory), so only a `./` or `../` value is a path and everything else goes
 * to myst unchanged, so a mistyped `./` path fails as a missing path, never as a template name.
 * `oak validate` warns when a bare value matches a directory in the journal repo.
 */
export function isInstanceRelativeTemplate(value: string): boolean {
  return /^\.\.?\//.test(value);
}

/** Makes a journal's template path absolute against the journal repo root, where
 *  `journal.yml` lives. Only `./` and `../` values change; see
 *  {@link isInstanceRelativeTemplate}. Exported so `oak validate` checks the path compose emits
 *  [R62]. */
export function resolveJournalTemplate(instanceRoot: string, value: string): string {
  return isInstanceRelativeTemplate(value) ? join(instanceRoot, value) : value;
}

function needsAbsolutizing(value: string): boolean {
  if (isAbsolute(value)) return false;
  return !isBrandAssetUrl(value);
}

/** Resolves one brand asset as compose does: a relative value against `<instanceRoot>`,
 *  URLs and absolute paths as they are. Exported so `oak validate` checks the path compose emits
 *  [R62]. */
export function resolveBrandAssetPath(instanceRoot: string, value: string): string {
  return needsAbsolutizing(value) ? join(instanceRoot, value) : value;
}

/** Makes the relative values in `raw` (one namespace of {@link BRAND_ASSET_KEYS}) absolute
 *  against `<instanceRoot>`. */
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

/** The fields compose reads from the project myst resolved, by myst's own names. */
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
  /** Path to oak's checkout, which holds paper-base.yml and oak's typst template. */
  engineRoot: string;
  /** Path to the journal repo; null with --no-instance. */
  instanceRoot: string | null;
  /** The project as myst resolved it (`loadConfig().project`). Read only. */
  resolvedProject: ResolvedProject;
  /** oak's version, read before the merge. */
  engineVersion: string;
  /** The paper's edition, read before the merge; selects `editions/<edition>.yml`. */
  edition: string;
  /** `/<repo>` in CI for GitHub Pages; empty locally and for previews. */
  baseUrl: string;
  /** Overrides for the PDF template and the site theme, from the CLI flags. */
  assetOverrides?: {
    /** `--typst-template <path>`: an explicit override, above every other template. */
    typstTemplate?: string;
    /** string → use it; null → omit site.template (myst default); undefined → release zip. */
    siteTemplate?: string | null;
  };
  /** The journal's `typst_template:`, read as written from `journal.yml` [R76]. It cannot be an
   *  `exports[].template` in an `extends:` layer: a second layer declaring `exports:` makes the
   *  merge unpredictable [R72], so paper-base stays the only one. A name, path or URL; a `./`
   *  path is made absolute ({@link resolveJournalTemplate}). */
  journalTypstTemplate?: string;
  /** false leaves the PDF download out of the site, for `oak start` while there is no PDF. */
  pdfDownload?: boolean;
  /** The brand's asset fields ({@link BRAND_ASSET_KEYS}), read as written from
   *  `brand/brand.yml`. compose makes relative values absolute against `<instanceRoot>`,
   *  since myst resolves them against the paper root [R62]. Read from brand.yml itself so a
   *  paper's own relative asset is never taken for the brand's. */
  brandAssets?: { site?: Record<string, string>; project?: Record<string, string> };
  /** The journal checkout `instanceRoot` is, recorded for the deposit; absent without one. */
  journal?: JournalStamp;
}

export interface OwnOverride {
  /** Merged into the base `project`. `options` carries the PDF watermark (`logo`) and the
   *  `oaktree-sapling` key with the {@link JournalStamp}, set key by key so the author's other options
   *  survive; `downloads` is appended to the author's. */
  project?: {
    exports?: Array<Record<string, unknown>>;
    downloads?: Array<Record<string, string>>;
    options?: Record<string, unknown>;
  };
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
 *  before anything is resolved [R52]. Warns without a journal.
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
    warnings.push(msg.build.noInstanceWarning);
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
    engineVersion,
    edition,
    baseUrl,
    assetOverrides = {},
  } = input;

  // The engine action reads the version and edition before the merge, the CLI after it; an
  // edition config declaring `project.options` could make them differ.
  const resolved = readEngineOptions(resolvedProject.options);
  if (resolved.version !== engineVersion || resolved.edition !== edition) {
    throw new Error(
      msg.build.coordinateMismatch(engineVersion, edition, resolved.version, resolved.edition),
    );
  }

  const { extendsChain, warnings } = extendsChainFor({ engineRoot, instanceRoot, edition });

  // ownOverride: oak's additions to the base config [R52].
  const ownOverride: OwnOverride = {};

  // Typst export: the resolved entry plus `output:` and `template:`, whole, since MyST merges
  // exports whole [R52].
  const typst = (resolvedProject.exports ?? []).find(
    (e) => e['format'] === 'typst' || e['id'] === TYPST_EXPORT_ID,
  );
  if (typst) {
    // Template precedence [R76]: author, then journal, then oak. A `template:` on the resolved
    // export can only be the author's, since paper-base and editions declare none [R72]. It is
    // honoured whatever it is; `oak validate` warns when it floats, and the deposit keeps
    // the resolved template, so a DOI stays reproducible.
    const authorTemplate =
      typeof typst['template'] === 'string' && typst['template']
        ? (typst['template'] as string)
        : undefined;
    const journalTemplate =
      input.journalTypstTemplate && instanceRoot
        ? resolveJournalTemplate(instanceRoot, input.journalTypstTemplate)
        : input.journalTypstTemplate;
    const engineTemplate = engineTypstTemplate(engineRoot);
    const template =
      assetOverrides.typstTemplate ?? authorTemplate ?? journalTemplate ?? engineTemplate;

    // A paper overriding the journal's template is allowed, but must show in the pull request;
    // `oak validate` reports it there too.
    if (authorTemplate && journalTemplate && !assetOverrides.typstTemplate) {
      warnings.push(msg.validate.templateOverride(authorTemplate, input.journalTypstTemplate));
    }

    ownOverride.project = { exports: [{ ...typst, template, output: TYPST_OUTPUT }] };
    // Offered only when the PDF can be served: `oak start` builds none (DOCS.start).
    if (input.pdfDownload !== false) {
      ownOverride.project.downloads = [{ id: TYPST_EXPORT_ID, title: msg.build.pdfDownloadTitle }];
    }
  } else {
    warnings.push(msg.build.noTypstExport);
  }

  // oak's pinned book-theme ({@link themeZipUrl}). `siteTemplate: null` leaves MyST's default
  // theme.
  const site: NonNullable<OwnOverride['site']> = {};
  const siteTemplate =
    assetOverrides.siteTemplate === undefined ? themeZipUrl() : assetOverrides.siteTemplate;
  if (siteTemplate !== null) {
    site.template = siteTemplate;
  }

  // Brand assets [R62]: relative values made absolute against the journal root, since MyST
  // resolves them against the paper root, where the journal's files are not. HTML assets go in
  // site.options, the PDF watermark in project.options.logo.
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

  // The {@link JournalStamp}, for the deposit [R66]. MyST merges `project.options` one key deep, so an
  // `oaktree-sapling` object replaces another whole: this one keeps the coordinates checked above.
  if (input.journal) {
    ownOverride.project = {
      ...ownOverride.project,
      options: {
        ...ownOverride.project?.options,
        'oaktree-sapling': { ...resolved, journal: input.journal },
      },
    };
  }

  if (site.template !== undefined || site.options) ownOverride.site = site;

  return {
    extendsChain,
    ownOverride,
    env: { BASE_URL: baseUrl },
    warnings,
  };
}
