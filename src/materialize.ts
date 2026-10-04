/**
 * What `oak build` and `oak validate` share: the myst interface and the two-pass write of
 * `myst.oak.yml`. A module of its own because build also needs validate's `runLayerA` between
 * the passes, and sharing through build.ts made the two import each other [R82] [R21].
 */
import { join } from 'node:path';
import type { ISession } from 'myst-cli';
import { compose, extendsChainFor, type ResolvedProject, type ComposeInput } from './compose.js';
import {
  readDoc,
  writeDerivedDoc,
  setExtends,
  applyOwnOverride,
  readEngineCoordinateRaw,
  readBrandAssetOptions,
  readJournalTypstTemplate,
  DERIVED_CONFIG_FILE,
} from './yaml-io.js';

export interface BuildOpts {
  all?: boolean;
  html?: boolean;
  /** Only the typst export, no site. Works offline, since the site needs the theme zip. */
  exportsOnly?: boolean;
}

/** The `myst start` options `oak start` passes through, under myst's names. */
export interface StartOpts {
  port?: number;
  serverPort?: number;
  headless?: boolean;
  keepHost?: boolean;
  template?: string;
  baseurl?: string;
}

/**
 * The interface to myst, implemented in myst.ts. `configFile` picks the config myst reads
 * [R71]; without it myst reads the author's `myst.yml`, which only a `validate` with nothing to
 * compose wants [R82].
 */
export interface MystEdge {
  /** The project as myst resolves it. */
  loadProject(dir: string, configFile?: string): Promise<ResolvedProject>;
  /** Builds from within `dir`. */
  build(dir: string, opts: BuildOpts, configFile?: string): Promise<void>;
  /** Starts the dev server from within `dir` and resolves once it is up. The caller must keep
   *  the process alive. */
  start(dir: string, opts: StartOpts, configFile?: string): Promise<void>;
  /**
   * Loads and processes the project, then runs `fn` with the session, for the editorial checks
   * [R59]. They need processed mdast, not a build.
   */
  withProjectSession<T>(
    dir: string,
    fn: (session: ISession) => Promise<T>,
    configFile?: string,
  ): Promise<T>;
}

export interface MaterializeInput {
  paperRoot: string;
  engineRoot: string;
  instanceRoot: string | null;
  engineRepo: string;
  baseUrl: string;
  assetOverrides?: ComposeInput['assetOverrides'];
  edge: MystEdge;
}

export interface MaterializeResult {
  /** The author's config merged with its `extends:` chain. It holds every field the layers
   *  declare, but not compose's additions, which are only in the derived file. */
  resolvedProject: ResolvedProject;
  /** `<paperRoot>/myst.oak.yml`, the file myst reads. */
  derivedPath: string;
  extendsChain: string[];
  /** The edition, read from the author's config before the merge, as the engine action does. */
  edition: string;
  /** compose's warnings, including the one for building without a journal. */
  warnings: string[];
}

/**
 * Writes `<paperRoot>/myst.oak.yml` in two passes [R71], for both `oak build` and `oak validate`
 * [R82]. The file stays: myst exits the process on success, and the paper template gitignores
 * it.
 *
 * `preflight` runs between the passes and may throw; `oak build` uses it to stop a broken paper
 * before compose [R21], so a paper broken in both ways reports the same error as before.
 */
export async function materializeDerived(
  input: MaterializeInput,
  preflight?: (project: ResolvedProject, ctx: { edition: string }) => void,
): Promise<MaterializeResult> {
  const { paperRoot, engineRoot, instanceRoot, engineRepo, baseUrl, assetOverrides, edge } = input;

  // The author's config is read, never written [R71].
  const authorPath = join(paperRoot, 'myst.yml');
  const derivedPath = join(paperRoot, DERIVED_CONFIG_FILE);
  const doc = readDoc(authorPath);

  // The version and edition, read before the merge [design §6a]. The path names the file in the
  // error.
  const { version: engineVersion, edition } = readEngineCoordinateRaw(doc, authorPath);

  // Pass 1. The author's config fills the derived file's base, where myst's merge is predictable,
  // and the engine layers stay `extends:`. Extending the author's myst.yml instead would make its
  // precedence over the edition unpredictable [R72].
  const { extendsChain } = extendsChainFor({ engineRoot, instanceRoot, edition });
  setExtends(doc, extendsChain);
  writeDerivedDoc(derivedPath, doc);

  const resolvedProject = await edge.loadProject(paperRoot, DERIVED_CONFIG_FILE);

  preflight?.(resolvedProject, { edition });

  // Read from brand.yml itself, so compose resolves only the brand's own assets against
  // `brand/` [R62].
  const brandAssets = instanceRoot ? readBrandAssetOptions(instanceRoot) : undefined;

  // The journal's typst template, read the same way from journal.yml [R76].
  const journalTypstTemplate = instanceRoot ? readJournalTypstTemplate(instanceRoot) : undefined;

  // compose, including the version cross-check [R36].
  const result = compose({
    paperRoot,
    engineRoot,
    instanceRoot,
    resolvedProject,
    engineRepo,
    engineVersion,
    edition,
    baseUrl,
    assetOverrides,
    brandAssets,
    journalTypstTemplate,
  });

  // Pass 2 sets the export's `template` and `output` [R71-out]. Without it, myst would take the
  // output path from the file that declares the export, a path the build never writes.
  applyOwnOverride(doc, result.ownOverride);
  writeDerivedDoc(derivedPath, doc);

  return { resolvedProject, derivedPath, extendsChain, edition, warnings: result.warnings };
}
