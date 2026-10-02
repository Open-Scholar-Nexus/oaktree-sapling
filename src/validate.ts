/**
 * `oak validate`, in two layers:
 *   A. oak's own rules: the paper id ([R12]), the layout ([R46] [R50]), the brand favicon and
 *      watermark ([R61] [R62]), the thumbnail ([R81]) and the `deposit/` names ([R28]). `oak
 *      build` runs these first too [R21].
 *   B. The editorial checks the journal turns on in `journal.yml` `checks:` (checks.ts).
 *
 * File and myst access is injected so the rules are testable; myst-cli comes in only through
 * myst.ts. The caller passes the repository, used to find the paper's own registry entry.
 */
import * as msg from './messages.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  JournalConfig,
  Registry,
  checkIdShape,
  checkIdUniqueness,
  type IdCheckResult,
} from './schema.js';
import { dirname, isAbsolute, join } from 'node:path';
import { resolveBrandAssetPath, isBrandAssetUrl, isInstanceRelativeTemplate } from './compose.js';
import { readBrandAssetOptions, readAuthorTypstTemplate, DERIVED_CONFIG_FILE } from './yaml-io.js';
import {
  runChecks,
  toCheckRun,
  CheckStatus,
  type EngineCheckResult,
  type CheckRun,
  type JournalCheck,
} from './checks.js';
import { materializeDerived, type MystEdge } from './materialize.js';
import { depositCollisions, RESERVED_DEPOSIT_NAMES } from './zenodo.js';
import type { ComposeInput } from './compose.js';

export interface FsProbes {
  existsProbe(path: string): boolean;
  /** Every path under a directory, recursive and relative. */
  listTree(dir: string): string[];
}
const realFs: FsProbes = {
  existsProbe: (p) => existsSync(p),
  listTree: (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : []),
};

/** What a finding blocks. `structural` (no index.md, a stray myst.yml) blocks the build;
 *  `identity` (the id), `brand` and `config` only block the merge, through the Journal checks,
 *  so a new paper with a placeholder id still builds. `config` covers keys that overlap between
 *  journal layers [R72], which make results unpredictable rather than impossible. */
export type FindingKlass = 'structural' | 'identity' | 'brand' | 'config';

export interface NamedFinding {
  check: string;
  severity: 'error' | 'warn';
  message: string;
  klass: FindingKlass;
}

/* ---- Layer A checks (pure) ---------------------------------------------- */

/** index.md and myst.yml at the paper root, and no other myst.yml under it [R50]. Returns the
 *  problems; empty means clean. */
export function checkLayout(
  paperRoot: string,
  probes: FsProbes,
): Array<{ severity: 'error'; message: string }> {
  const out: Array<{ severity: 'error'; message: string }> = [];
  for (const f of ['index.md', 'myst.yml']) {
    if (!probes.existsProbe(join(paperRoot, f))) {
      out.push({ severity: 'error', message: msg.validate.missingFile(f) });
    }
  }
  const stray = probes
    .listTree(paperRoot)
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => {
      if (f === 'myst.yml' || !/(^|\/)myst\.yml$/.test(f)) return false;
      // Skip directories tools put inside the paper root: `.engine/` (where the engine action
      // checks oak out, with its own template myst.yml files), any dotdir, `_build/` and
      // `node_modules/`.
      const dirs = f.split('/').slice(0, -1);
      return !dirs.some((d) => d.startsWith('.') || d === '_build' || d === 'node_modules');
    });
  for (const s of stray) {
    out.push({
      severity: 'error',
      message: msg.validate.strayMystYml(s),
    });
  }
  return out;
}

/** Warns when the brand has no favicon that resolves: a missing one makes the HTML prerender
 *  fail on /favicon.ico [R61]. A URL resolves for HTML, so it passes. */
export function checkBrandFavicon(
  input: { instanceRoot: string | null; favicon?: string },
  probes: FsProbes,
): IdCheckResult {
  const { instanceRoot, favicon } = input;
  if (!favicon) {
    return {
      ok: false,
      severity: 'warn',
      message: msg.validate.brandNoFavicon,
    };
  }
  if (isBrandAssetUrl(favicon)) return { ok: true };
  const resolved = instanceRoot ? resolveBrandAssetPath(instanceRoot, favicon) : favicon;
  return probes.existsProbe(resolved)
    ? { ok: true }
    : { ok: false, severity: 'warn', message: msg.validate.brandFaviconUnresolved(favicon) };
}

/** Warns when the brand's PDF watermark (`project.options.logo`) is absent, a URL (typst cannot
 *  fetch) or a local file that does not resolve [R62] [R68]. */
export function checkBrandWatermark(
  input: { instanceRoot: string | null; logo?: string },
  probes: FsProbes,
): IdCheckResult {
  const { instanceRoot, logo } = input;
  if (!logo) {
    return {
      ok: false,
      severity: 'warn',
      message: msg.validate.brandNoWatermark,
    };
  }
  if (isBrandAssetUrl(logo)) {
    return {
      ok: false,
      severity: 'warn',
      message: msg.validate.brandWatermarkIsUrl(logo),
    };
  }
  const resolved = instanceRoot ? resolveBrandAssetPath(instanceRoot, logo) : logo;
  return probes.existsProbe(resolved)
    ? { ok: true }
    : { ok: false, severity: 'warn', message: msg.validate.brandWatermarkUnresolved(logo) };
}

/**
 * Warns when `project.thumbnail` names a file that is not there. paper-base sets it, so the
 * gallery knows where to look, and setting it turns off myst's own fallback (the first image in
 * the paper): a wrong path means no thumbnail at all and a blank gallery card.
 *
 * myst resolves it against the paper's source folder, not the layer that set it, so it is
 * checked against the paper root and needs no rewriting, unlike brand assets [R62] [R68] or
 * templates [R74]. When unset, the fallback works again; a URL passes, since myst downloads it
 * [R80].
 */
export function checkThumbnail(
  input: { paperRoot: string; thumbnail?: string },
  probes: FsProbes,
): IdCheckResult {
  const { paperRoot, thumbnail } = input;
  if (!thumbnail) return { ok: true };
  if (isBrandAssetUrl(thumbnail)) return { ok: true };
  return probes.existsProbe(join(paperRoot, thumbnail))
    ? { ok: true }
    : {
        ok: false,
        severity: 'warn',
        message: msg.validate.thumbnailUnresolved(thumbnail),
      };
}

/**
 * A `deposit/` file whose name oak also writes into the bundle [R28], reported on the pull
 * request as well as refused at release. Shares {@link depositCollisions} with `oak release`;
 * top level only, as in the bundle.
 */
export function checkDepositNames(input: { paperRoot: string }, probes: FsProbes): NamedFinding[] {
  const entries = probes
    .listTree(join(input.paperRoot, 'deposit'))
    .map((f) => f.replace(/\\/g, '/'));
  const files = entries.filter(
    (e) => !e.includes('/') && !entries.some((o) => o.startsWith(`${e}/`)),
  );
  const collisions = depositCollisions(files);
  if (!collisions.length) return [];
  return [
    {
      check: 'deposit-names',
      severity: 'error',
      message: msg.validate.depositCollision(collisions, RESERVED_DEPOSIT_NAMES),
      klass: 'config',
    },
  ];
}

/* ---- typst template checks ([R76]) --------------------------------------- */

/**
 * Whether a template reference floats: names something whose bytes can change while the
 * reference stays the same, like a branch URL [R5]. Remote is fine when pinned. Floating only
 * warns: the deposit keeps the resolved template, so a DOI stays reproducible, and only the live
 * site may render differently later; a floating template is normal while developing one.
 *
 * Warns only on forms that clearly float, so a pin we cannot see (a versioned zip URL) passes.
 */
export function isFloatingTemplate(value: string): boolean {
  if (isBrandAssetUrl(value)) {
    const [url, ref] = value.split('#');
    if (/\/refs\/heads\//.test(url!)) return true;
    if (/\/archive\/(main|master|HEAD|develop)\.(zip|tar\.gz)$/.test(url!)) return true;
    // A `.git` URL is floating unless it carries a pinned-looking ref (a sha or a version tag).
    if (/\.git$/.test(url!)) return !(ref && /^([0-9a-f]{7,40}|v?\d)/.test(ref));
    return false;
  }
  // A local path is committed and reviewed, so it does not float.
  if (isAbsolute(value) || isInstanceRelativeTemplate(value)) return false;
  // A bare template name resolves against the live template API, so it floats [design §7].
  return true;
}

/**
 * The template findings, from the two layers a paper can change: the author's
 * `exports[].template` and the journal's `typst_template`. oak's own template needs none: a
 * checkout is fixed bytes, and the release zip is pinned to the tag.
 *
 * compose also warns about an author override, but a build log is not a review; this puts it in
 * the Check Run and the pull request comment, where an editor decides. A warning, since allowing
 * it is the journal's call.
 */
export function checkTemplates(
  input: { instanceRoot: string | null; authorTemplate?: string; tenantTemplate?: string },
  probes: FsProbes,
): NamedFinding[] {
  const { instanceRoot, authorTemplate, tenantTemplate } = input;
  const out: NamedFinding[] = [];
  const warn = (check: string, message: string) =>
    out.push({ check, severity: 'warn', message, klass: 'config' });

  if (authorTemplate && tenantTemplate) {
    warn('template-override', msg.validate.templateOverride(authorTemplate, tenantTemplate));
  }

  for (const [layer, value] of [
    ['author', authorTemplate],
    ['journal', tenantTemplate],
  ] as const) {
    if (!value || !isFloatingTemplate(value)) continue;
    warn('template-floating', msg.validate.templateFloating(layer, value));
  }

  // Only `./` or `../` is a path, so a bare `templates/typst` goes to myst as a name and fails
  // later in a confusing way. Warn when a directory with that name exists: then a path was
  // meant.
  if (tenantTemplate && instanceRoot && !isBrandAssetUrl(tenantTemplate)) {
    const bare = !isAbsolute(tenantTemplate) && !isInstanceRelativeTemplate(tenantTemplate);
    if (bare && probes.existsProbe(join(instanceRoot, tenantTemplate))) {
      warn('template-name-ambiguous', msg.validate.templateNameAmbiguous(tenantTemplate));
    }
  }

  return out;
}

/* ---- journal repository readers ----------------------------------------- */

/** A journal with no settings, so a run without a readable `journal.yml` keeps its shape while
 *  the [R116] finding blocks. */
function emptyJournal(): JournalConfig {
  return JournalConfig.parse({ name: 'unknown' });
}

/** null means the journal repository has no `journal.yml`: broken, unlike `--no-instance`
 *  [R116]. */
function loadJournal(instanceRoot: string | null, probes: FsProbes): JournalConfig | null {
  if (instanceRoot) {
    const p = join(instanceRoot, 'journal.yml');
    if (!probes.existsProbe(p)) return null;
    return JournalConfig.parse(parse(readFileSync(p, 'utf8')));
  }
  return emptyJournal();
}

function loadRegistry(instanceRoot: string | null, probes: FsProbes): Registry | null {
  if (instanceRoot) {
    const p = join(instanceRoot, 'registry', 'papers.yml');
    if (probes.existsProbe(p)) return Registry.parse(parse(readFileSync(p, 'utf8')));
  }
  return null;
}

/** The paper's own registry entry, found by its repository, so the uniqueness check skips it.
 *  Without a repository it cannot be found, so callers pass one (environment or git origin). */
function findSelf(registry: Registry | null, repo: string | null): { slug: string } | undefined {
  if (!registry || !repo) return undefined;
  const e = registry.find((x) => x.location.repo === repo);
  return e ? { slug: e.slug } : undefined;
}

/* ---- overlapping keys between layers ([R72]) ---------------------------- */

/**
 * The keys one layer declares. `site.options` and `project.options` merge field by field, so two
 * layers may set different keys inside them, and those are compared at the leaf
 * (`site.options.logo`) [R68]. Everything else merges at the top-level key (`exports` whole, by
 * id [R52] [R53]), so is compared there (`project.venue`).
 */
export function declaredKeys(config: unknown): string[] {
  const out: string[] = [];
  const root = (config ?? {}) as Record<string, unknown>;
  for (const ns of ['project', 'site'] as const) {
    const section = root[ns] as Record<string, unknown> | undefined;
    if (!section || typeof section !== 'object') continue;
    for (const [key, value] of Object.entries(section)) {
      if (key === 'options' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const leaf of Object.keys(value as Record<string, unknown>)) {
          out.push(`${ns}.options.${leaf}`);
        }
      } else {
        out.push(`${ns}.${key}`);
      }
    }
  }
  return out;
}

/**
 * The layers must declare different keys [R72]. MyST loads `extends:` entries in parallel into
 * one shared result, so when two layers set the same key, the one that loads last wins, and that
 * can change between runs. Only the paper's own config, the base, wins predictably. Takes parsed
 * configs, so it is testable without the filesystem.
 */
export function checkLayerDisjointness(
  layers: Array<{ name: string; config: unknown }>,
): Array<{ severity: 'error'; message: string }> {
  const seen = new Map<string, string>(); // key → first layer that declared it
  const clashes: string[] = [];
  for (const { name, config } of layers) {
    for (const key of declaredKeys(config)) {
      const prior = seen.get(key);
      if (prior && prior !== name) clashes.push(`${key} (${prior} vs ${name})`);
      else seen.set(key, name);
    }
  }
  if (!clashes.length) return [];
  return [
    {
      severity: 'error',
      message: msg.validate.layersOverlap(clashes.join(', ')),
    },
  ];
}

function readLayer(path: string, probes: FsProbes): unknown | null {
  if (!probes.existsProbe(path)) return null;
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // a malformed layer is another check's problem, not this one's
  }
}

/** A config's own `extends:`, which myst takes as a string or a list. */
function extendsRefs(config: unknown): string[] {
  const raw = (config as { extends?: unknown } | null)?.extends;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((r): r is string => typeof r === 'string' && !!r);
}

/**
 * Each layer plus everything its own `extends:` pulls in [R119]. A nested layer merges into the
 * same result, so its keys count as the parent's (named `<parent> -> <ref>`). A reference this
 * cannot follow is returned in `unreadable`, since the check is unsound without it.
 */
export function expandLayers(
  roots: Array<{ name: string; path: string }>,
  probes: FsProbes,
): { layers: Array<{ name: string; config: unknown }>; unreadable: string[] } {
  const layers: Array<{ name: string; config: unknown }> = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  const walk = (name: string, path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const config = readLayer(path, probes);
    if (config == null) return;
    layers.push({ name, config });
    for (const ref of extendsRefs(config)) {
      const target = isBrandAssetUrl(ref) ? null : isAbsolute(ref) ? ref : join(dirname(path), ref);
      if (!target || !probes.existsProbe(target)) {
        unreadable.push(`${ref} (from ${name})`);
        continue;
      }
      walk(`${name} -> ${ref}`, target);
    }
  };
  for (const r of roots) walk(r.name, r.path);
  return { layers, unreadable };
}

/* ---- Layer A aggregate --------------------------------------------------- */

export function runLayerA(
  input: {
    paperRoot: string;
    instanceRoot: string | null;
    /** The composed project from pass 1 [R82]: the author's config with the `extends:` chain,
     *  without compose's pass-2 additions (`output`, `template`, `site.template`, brand asset
     *  paths). Pass 1 is what `oak build` has when it runs these checks, between the passes
     *  [R21]; Layer B reads the pass-2 file. No check here needs a pass-2 field yet; one that
     *  does should change this, rather than read the derived file. The author's template is
     *  read separately (below), since the composed view no longer says who set it. */
    project: { id?: string; thumbnail?: string };
    repo: string | null;
    /** oak's checkout, for the [R72] check. Skipped when absent. */
    engineRoot?: string | null;
    /** The edition, to find `editions/<edition>.yml`. Skipped when absent. */
    edition?: string | null;
  },
  probes: FsProbes = realFs,
): NamedFinding[] {
  const { paperRoot, instanceRoot, project, repo, engineRoot, edition } = input;
  const findings: NamedFinding[] = [];
  const add = (check: string, klass: FindingKlass, r: IdCheckResult) => {
    if (!r.ok) findings.push({ check, severity: r.severity, message: r.message, klass });
  };

  const loaded = loadJournal(instanceRoot, probes);
  const registry = loadRegistry(instanceRoot, probes);

  // No journal settings is not a pass: every id rule and Layer B check would do nothing [R116].
  if (loaded === null) {
    findings.push({
      check: 'journal-config',
      severity: 'error',
      message: msg.validate.journalMissing(instanceRoot!),
      klass: 'config',
    });
  }
  const journal = loaded ?? emptyJournal();

  // Both id keys are optional. The placeholder id is oak's (ENGINE_ID_SENTINEL); the pattern is
  // the journal's, so a missing one is reported rather than filled in [R119].
  if (instanceRoot && loaded && !loaded.id_pattern) {
    findings.push({
      check: 'id-policy',
      severity: 'warn',
      message: msg.validate.idNoPattern,
      klass: 'config',
    });
  }

  if (!project.id) {
    findings.push({
      check: 'id-present',
      severity: 'error',
      message: msg.validate.idMissing,
      klass: 'identity',
    });
  } else {
    add(
      'id-shape',
      'identity',
      checkIdShape(project.id, {
        id_sentinel: journal.id_sentinel,
        id_pattern: journal.id_pattern,
      }),
    );
    add(
      'id-uniqueness',
      'identity',
      checkIdUniqueness(project.id, registry, findSelf(registry, repo), {
        selfIdentifiable: repo != null,
      }),
    );
  }

  for (const r of checkLayout(paperRoot, probes)) {
    findings.push({
      check: 'layout',
      severity: r.severity,
      message: r.message,
      klass: 'structural',
    });
  }

  // A missing thumbnail is `structural` but only a warning, so a draft without one still builds.
  // It becomes required at registration: the journal site's `--strict` build fails on a
  // registered paper without one [R80].
  add(
    'thumbnail',
    'structural',
    checkThumbnail({ paperRoot, thumbnail: project.thumbnail }, probes),
  );

  findings.push(...checkDepositNames({ paperRoot }, probes));

  // [R72]: the three extends layers must own disjoint keys, or precedence is a race.
  if (engineRoot && instanceRoot && edition) {
    const { layers, unreadable } = expandLayers(
      [
        { name: 'paper-base.yml', path: join(engineRoot, 'paper-base.yml') },
        { name: `editions/${edition}.yml`, path: join(instanceRoot, 'editions', `${edition}.yml`) },
        { name: 'brand/brand.yml', path: join(instanceRoot, 'brand', 'brand.yml') },
      ],
      probes,
    );
    if (unreadable.length) {
      findings.push({
        check: 'extends-unreadable',
        severity: 'error',
        message: msg.validate.layerExtendsUnreadable(unreadable.join(', ')),
        klass: 'config',
      });
    }
    for (const r of checkLayerDisjointness(layers)) {
      findings.push({
        check: 'extends-disjoint',
        severity: r.severity,
        message: r.message,
        klass: 'config',
      });
    }
  }

  const brand = instanceRoot ? readBrandAssetOptions(instanceRoot) : { site: {}, project: {} };
  add(
    'brand-favicon',
    'brand',
    checkBrandFavicon({ instanceRoot, favicon: brand.site.favicon }, probes),
  );
  add(
    'brand-watermark',
    'brand',
    checkBrandWatermark({ instanceRoot, logo: brand.project.logo }, probes),
  );

  // The author's template is read from their own myst.yml, not `project` [R82]: the composed
  // export carries compose's choice, so `template-override` would fire on every paper. As with
  // brand assets [R68] and the journal's template [R79], a value whose source matters is read
  // outside the merge.
  findings.push(
    ...checkTemplates(
      {
        instanceRoot,
        authorTemplate: readAuthorTypstTemplate(paperRoot),
        tenantTemplate: journal.typst_template,
      },
      probes,
    ),
  );

  return findings;
}

/* ---- Layer B preconditions ---------------------------------------------- */

/** The one catalog check that needs build output, not only a loaded project. */
const EXPORTS_EXIST = 'exports-exist';

/**
 * Takes out the selected checks that cannot run without a build, today only `exports-exist`,
 * which looks for the built PDF. `oak validate` does not build, so it would fail on every paper.
 * Each becomes an `error` result ("could not run"; `CheckStatus` has no skip) marked `optional`,
 * so it never blocks a merge whatever the journal set [R82].
 *
 * Building first is not an option: `check.yml` runs apart from `ci.yml`, so it would either tie
 * the merge to the build or build every pull request twice.
 */
export function splitUnrunnableChecks(
  journalChecks: JournalCheck[],
  paperRoot: string,
  probes: FsProbes,
): { runnable: JournalCheck[]; unrunnable: EngineCheckResult[] } {
  if (probes.existsProbe(join(paperRoot, '_build', 'exports'))) {
    return { runnable: journalChecks, unrunnable: [] };
  }
  return {
    runnable: journalChecks.filter((c) => c.id !== EXPORTS_EXIST),
    unrunnable: journalChecks
      .filter((c) => c.id === EXPORTS_EXIST)
      .map(() => ({
        id: EXPORTS_EXIST,
        status: CheckStatus.error,
        message: msg.validate.needsBuildArtifacts,
        cause: 'missing-build-artifacts',
        optional: true,
      })),
  };
}

/* ---- the verb ------------------------------------------------------------ */

export interface ValidateResult {
  status: 'ok' | 'error';
  errors: NamedFinding[];
  warnings: NamedFinding[];
  checks: EngineCheckResult[];
  checkRun: CheckRun;
  /** Notes about how the run happened, such as running uncomposed [R82]. They never decide the
   *  outcome: a failed compose is the `compose` finding. They go into `checkRun.summary`, so the
   *  pull request shows them [R71]. */
  notes: string[];
  exitCode: number;
}

export async function runValidate(
  input: {
    paperRoot: string;
    instanceRoot: string | null;
    edge: MystEdge;
    /** oak's checkout and the edition, for the [R72] check and the composed view. */
    engineRoot?: string | null;
    edition?: string | null;
    /** The `engine_repo` pin, only for compose's fallback asset URLs; no check reads it
     *  [R82]. */
    engineRepo?: string;
    /** The asset overrides `oak build` passes, and they must match: both write the same
     *  `myst.oak.yml`, and different inputs would write different files. */
    assetOverrides?: ComposeInput['assetOverrides'];
  },
  opts: { strict?: boolean; repo?: string | null; pathBase?: string } = {},
  probes: FsProbes = realFs,
): Promise<ValidateResult> {
  const repo = opts.repo ?? null;
  const notes: string[] = [];

  // Composed when there is something to compose [R82]: paper-base's thumbnail and typst export
  // exist only after the merge, so checking the author's file alone would pass them [R81].
  // Shared with `oak build` so the two read the same config [R71]. A bare local run or
  // `--no-instance` has nothing to compose [R193]. Guarded: validate reports, and a crash tells
  // the author less than a finding.
  let project: { id?: string; exports?: Array<Record<string, unknown>>; thumbnail?: string };
  let configFile: string | undefined;
  let composeFailure: string | undefined;
  const composable = !!input.engineRoot && !!input.instanceRoot;
  if (composable) {
    try {
      const materialized = await materializeDerived({
        paperRoot: input.paperRoot,
        engineRoot: input.engineRoot!,
        instanceRoot: input.instanceRoot,
        engineRepo: input.engineRepo ?? 'unknown/engine',
        baseUrl: '', // no site is built here; compose only needs it for the build env
        assetOverrides: input.assetOverrides,
        edge: input.edge,
      });
      project = materialized.resolvedProject;
      configFile = DERIVED_CONFIG_FILE;
    } catch (e) {
      // With oak's checkout and a journal present, a failed compose is the paper's own mistake
      // (a wrong `edition:`, a missing version, the [R36] check), and `oak build` would fail the
      // same way, so it blocks the merge; having nothing to compose only adds a note. Caught, so
      // the rest of the report still runs.
      composeFailure = (e as Error).message;
      notes.push(msg.validate.noteComposeFailed(composeFailure));
    }
  } else {
    notes.push(msg.validate.noteUncomposed);
  }
  project ??= (await input.edge.loadProject(input.paperRoot)) as typeof project;

  // Layer A: engine invariants
  const layerA = runLayerA(
    {
      paperRoot: input.paperRoot,
      instanceRoot: input.instanceRoot,
      project,
      repo,
      engineRoot: input.engineRoot ?? null,
      edition: input.edition ?? null,
    },
    probes,
  );
  // Recorded as `config`: it blocks the merge and Layer B still runs, so the author sees every
  // finding at once. Without a compose, Layer B reads the author's own config, so some of its
  // results may not apply; the note says so.
  if (composeFailure) {
    layerA.push({
      check: 'compose',
      severity: 'error',
      message: msg.validate.composeFailed(composeFailure),
      klass: 'config',
    });
  }
  const errors = layerA.filter((f) => f.severity === 'error');
  const warnings = layerA.filter((f) => f.severity === 'warn');

  // Layer B: the journal's editorial checks (@curvenote/check-implementations). They read the
  // myst store, so they run in a processed project session, on the derived config with its
  // pass-2 additions [R82]. When Layer A finds a structural error myst cannot process the
  // project, so Layer B is skipped rather than crash the report; otherwise it is guarded, so a
  // myst or curvenote error becomes a check error.
  // Layer A already blocked on missing journal settings [R116]; the default keeps the shape.
  const journal = loadJournal(input.instanceRoot, probes) ?? emptyJournal();
  let checks: EngineCheckResult[] = [];
  // Only structural errors stop myst processing. A bad id does not, so the editorial checks
  // still run and the author sees every finding at once.
  const structuralErrors = errors.filter((f) => f.klass === 'structural');
  // Checks whose precondition is unmet are reported, not run [R82]; see splitUnrunnableChecks.
  const { runnable, unrunnable } = splitUnrunnableChecks(
    (journal.checks ?? []) as JournalCheck[],
    input.paperRoot,
    probes,
  );
  checks = unrunnable;
  if (structuralErrors.length === 0) {
    try {
      checks = [
        ...unrunnable,
        ...(await input.edge.withProjectSession(
          input.paperRoot,
          (session) => runChecks(session, runnable),
          configFile, // the COMPOSED config when we have one ([R82])
        )),
      ];
    } catch (e) {
      checks = [
        ...unrunnable,
        {
          id: 'editorial-checks',
          status: CheckStatus.error,
          message: msg.validate.editorialLoadFailed((e as Error).message),
        },
      ];
    }
  }

  // The Check Run's results: Layer A findings (errors block, warnings are optional) and Layer B's.
  const layerAResults: EngineCheckResult[] = layerA.map((f) => ({
    id: f.check,
    status: CheckStatus.fail,
    message: f.message,
    // --strict blocks warnings, so they gate the Check Run too ([R119]).
    optional: opts.strict ? false : f.severity === 'warn',
  }));
  // Make curvenote's absolute paths relative to the checkout root, so GitHub can resolve them;
  // the paper root by default, which is the repository root for a single-paper repository.
  const checkRun = toCheckRun(
    [...layerAResults, ...checks],
    opts.pathBase ?? input.paperRoot,
    notes,
  );

  const blockingCheckFail = checks.some(
    (c) => (c.status === CheckStatus.fail || c.status === CheckStatus.error) && !c.optional,
  );
  const hasError = errors.length > 0 || blockingCheckFail;
  // --strict warnings block the verdict and the Check Run, not just the exit code ([R119]).
  const failed = hasError || (opts.strict && warnings.length > 0);
  const exitCode = failed ? 1 : 0;

  return { status: failed ? 'error' : 'ok', errors, warnings, checks, checkRun, notes, exitCode };
}
