/**
 * `oak build`. The author's `myst.yml` is read, never written [R71]; oak writes the derived
 * config `myst.oak.yml` beside it and builds from that, in two passes [R52]:
 *
 * 1. The author's config with the `extends:` chain, loaded to resolve the whole project.
 * 2. compose's additions (the typst export, the theme) written over it, then the build.
 *
 * `oak validate` shares both passes through `materialize.ts`, so it checks what gets built
 * [R82]. The myst calls are injected (`MystEdge`).
 */
import { existsSync } from 'node:fs';
import { type ResolvedProject } from './compose.js';
import { engineTypstTemplate } from './assets.js';
import { runOakChecks } from './validate.js';
import {
  materializeDerived,
  type MaterializeInput,
  type MaterializeResult,
  type BuildOpts,
  type StartOpts,
} from './materialize.js';
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { currentRepo } from './gh.js';
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

  const oakWarnings: string[] = [];
  const { resolvedProject, extendsChain, warnings, typstTemplate } = await materializeDerived(
    input,
    (project, { edition }) => {
      // oak's checks run before the build, the slow part.
      const oakFindings = runOakChecks({
        paperRoot,
        instanceRoot,
        project,
        repo: currentRepo(undefined, paperRoot),
        engineRoot,
        edition,
      });
      // Only structural errors stop the build. The journal's checks enforce the paper id
      // (placeholder, invalid, duplicate) at merge, so a new repo still builds a preview and the
      // id problem is a warning.
      const blocking = oakFindings.filter(
        (f) => f.severity === 'error' && f.klass === 'structural',
      );
      if (blocking.length) {
        throw new Error(
          msg.build.preflightFailed(
            blocking.map((f) => `  - [${f.check}] ${f.message}`).join('\n'),
          ),
        );
      }
      oakWarnings.push(
        ...oakFindings
          .filter(
            (f) => f.severity === 'warn' || (f.severity === 'error' && f.klass !== 'structural'),
          )
          .map((f) => `[${f.check}] ${f.message}`),
      );
    },
  );

  // Every install ships oak's template, so a PDF build that picks it and finds it missing is a
  // broken install.
  const buildsPdf = buildOpts.exportsOnly || buildOpts.all;
  if (
    buildsPdf &&
    typstTemplate === engineTypstTemplate(engineRoot) &&
    !existsSync(typstTemplate)
  ) {
    throw new UserError(msg.build.noEngineTypstTemplate(typstTemplate));
  }

  if (baseUrl) process.env.BASE_URL = baseUrl;
  await edge.build(paperRoot, buildOpts, DERIVED_CONFIG_FILE);

  return { resolvedProject, extendsChain, warnings: [...warnings, ...oakWarnings] };
}

export interface RunStartInput extends MaterializeInput {
  startOpts?: StartOpts;
}

/**
 * `oak start`: composes as `oak build` does and serves the derived config, so a local preview
 * matches the CI build. It runs none of oak's checks, so a placeholder id does not block
 * previewing a draft; `oak validate` and the pull request check do the judging.
 */
export async function runStart(input: RunStartInput): Promise<MaterializeResult> {
  const { paperRoot, startOpts = {}, edge } = input;
  const materialized = await materializeDerived(input);
  await edge.start(paperRoot, startOpts, DERIVED_CONFIG_FILE);
  return materialized;
}
