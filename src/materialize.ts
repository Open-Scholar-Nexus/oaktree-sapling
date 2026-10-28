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
  dropJournalStamp,
} from './yaml-io.js';
import { ENGINE_VERSION, type JournalStamp } from './schema.js';
import * as msg from './messages.js';
import { UserError } from './messages.js';

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
   * They need processed mdast, not a build.
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
  journalRoot: string | null;
  /** Which journal checkout `journalRoot` is, for the derived config ({@link JournalStamp}). */
  journalStamp?: JournalStamp;
  baseUrl: string;
  assetOverrides?: ComposeInput['assetOverrides'];
  pdfDownload?: ComposeInput['pdfDownload'];
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
  /** The typst template compose chose; undefined without a typst export. */
  typstTemplate?: string;
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
  const {
    paperRoot,
    engineRoot,
    journalRoot,
    journalStamp,
    baseUrl,
    assetOverrides,
    pdfDownload,
    edge,
  } = input;

  // The author's config is read, never written [R71].
  const authorPath = join(paperRoot, 'myst.yml');
  const derivedPath = join(paperRoot, DERIVED_CONFIG_FILE);
  const doc = readDoc(authorPath);

  // The version and edition, read before the merge [design §6a]. The path names the file in the
  // error.
  const { version: engineVersion, edition } = readEngineCoordinateRaw(doc, authorPath);
  // Refused as the engine action refuses it, also when OAK_USE_RUNNING skips `handOff`.
  if (!ENGINE_VERSION.test(engineVersion)) {
    throw new UserError(msg.build.badEngineVersion(engineVersion, authorPath));
  }

  // Pass 1. The author's config fills the derived file's base, where myst's merge is predictable,
  // and the engine layers stay `extends:`. Extending the author's myst.yml instead would make its
  // precedence over the edition unpredictable [R72].
  const { extendsChain } = extendsChainFor({ engineRoot, journalRoot, edition });
  setExtends(doc, extendsChain);
  // The journal stamp is oak's to write; `oak validate` warns about an author's.
  dropJournalStamp(doc);
  writeDerivedDoc(derivedPath, doc);

  const resolvedProject = await edge.loadProject(paperRoot, DERIVED_CONFIG_FILE);

  preflight?.(resolvedProject, { edition });

  // Read from brand.yml itself, so compose resolves only the brand's own assets against the
  // journal root [R62].
  const brandAssets = journalRoot ? readBrandAssetOptions(journalRoot) : undefined;

  // The journal's typst template, read the same way from journal.yml [R76].
  const journalTypstTemplate = journalRoot ? readJournalTypstTemplate(journalRoot) : undefined;

  // compose, including the version cross-check [R36].
  const result = compose({
    paperRoot,
    engineRoot,
    journalRoot,
    resolvedProject,
    engineVersion,
    edition,
    baseUrl,
    assetOverrides,
    pdfDownload,
    brandAssets,
    journalTypstTemplate,
    journal: journalStamp,
  });

  // Pass 2 sets the export's `template` and `output` [R71-out]. Without it, myst would take the
  // output path from the file that declares the export, a path the build never writes.
  applyOwnOverride(doc, result.ownOverride);
  writeDerivedDoc(derivedPath, doc);

  const typstTemplate = result.ownOverride.project?.exports?.[0]?.['template'] as
    string | undefined;
  return {
    resolvedProject,
    derivedPath,
    extendsChain,
    edition,
    warnings: result.warnings,
    typstTemplate,
  };
}
