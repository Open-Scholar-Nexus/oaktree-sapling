/**
 * `oak build`. The author's `myst.yml` is read, never written [R71]; oak writes the derived
 * config `myst.oak.yml` beside it and builds from that, in two passes [R52] [design §12a]:
 *
 * 1. The author's config with the `extends:` chain, loaded to resolve the whole project.
 * 2. compose's additions (the typst export, the theme) written over it, then the build.
 *
 * `oak validate` shares both passes through `materialize.ts`, so it checks what gets built
 * [R82]. The myst calls are injected (`MystEdge`) so tests can use a fake.
 */
import { type ResolvedProject } from './compose.js';
import { runLayerA } from './validate.js';
import {
  materializeDerived,
  type MaterializeInput,
  type MaterializeResult,
  type BuildOpts,
  type StartOpts,
} from './materialize.js';
import * as msg from './messages.js';
import { originRepo } from './gh.js';
import { DERIVED_CONFIG_FILE } from './yaml-io.js';

export interface RunBuildInput extends MaterializeInput {
  /** Defaults to HTML and exports. */
  buildOpts?: BuildOpts;
}

export interface RunBuildResult {
  resolvedProject: ResolvedProject;
  extendsChain: string[];
  warnings: string[];
}

export async function runBuild(input: RunBuildInput): Promise<RunBuildResult> {
  const {
    paperRoot,
    instanceRoot,
    engineRoot,
    baseUrl,
    buildOpts = { all: true, html: true },
    edge,
  } = input;

  const layerAWarnings: string[] = [];
  const { resolvedProject, extendsChain, warnings } = await materializeDerived(
    input,
    (project, { edition }) => {
      // The structural checks run before the expensive build [R21]; editorial ones are the pull
      // request check's job.
      const layerA = runLayerA({
        paperRoot,
        instanceRoot,
        project,
        repo: process.env.GITHUB_REPOSITORY ?? originRepo(paperRoot),
        engineRoot,
        edition,
      });
      // Only structural errors stop the build. An id error (placeholder, invalid, duplicate) is
      // enforced at merge by the Journal checks, so a new repository still builds a preview; it
      // is reported as a warning.
      const blocking = layerA.filter((f) => f.severity === 'error' && f.klass === 'structural');
      if (blocking.length) {
        throw new Error(
          msg.build.preflightFailed(
            blocking.map((f) => `  - [${f.check}] ${f.message}`).join('\n'),
          ),
        );
      }
      layerAWarnings.push(
        ...layerA
          .filter(
            (f) => f.severity === 'warn' || (f.severity === 'error' && f.klass !== 'structural'),
          )
          .map((f) => `[${f.check}] ${f.message}`),
      );
    },
  );

  if (baseUrl) process.env.BASE_URL = baseUrl;
  await edge.build(paperRoot, buildOpts, DERIVED_CONFIG_FILE);

  return { resolvedProject, extendsChain, warnings: [...warnings, ...layerAWarnings] };
}

export interface RunStartInput extends MaterializeInput {
  startOpts?: StartOpts;
}

/**
 * `oak start`: composes as `oak build` does and serves the derived config, so a local preview
 * matches the CI build. It skips the structural checks, so a placeholder id does not block
 * previewing a draft; `oak validate` and the pull request check do the judging.
 */
export async function runStart(input: RunStartInput): Promise<MaterializeResult> {
  const { paperRoot, startOpts = {}, edge } = input;
  const materialized = await materializeDerived(input);
  await edge.start(paperRoot, startOpts, DERIVED_CONFIG_FILE);
  return materialized;
}
