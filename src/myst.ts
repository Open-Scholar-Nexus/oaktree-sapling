/**
 * The only module that imports myst-cli, so the rest of oak is testable without it. oak calls
 * myst as a library, not a subprocess [design §7a].
 *
 * `loadConfig` alone does not set the current site and project, which `build` needs for HTML
 * ("No site configuration found"). So each call first runs `findCurrentProjectAndLoad` and
 * `findCurrentSiteAndLoad`, as the myst CLI does.
 */
import {
  Session,
  loadConfig,
  build,
  collectAllBuildExportOptions,
  localArticleExport,
  startServer,
  processProject,
  findCurrentProjectAndLoad,
  findCurrentSiteAndLoad,
  filterPages,
  selectFile,
  selectors,
} from 'myst-cli';
import type { ISession } from 'myst-cli';
import { resolve } from 'node:path';
import { toText } from 'myst-common';
import { selectAll } from 'unist-util-select';
import type { MystEdge, StartOpts } from './materialize.js';
import type { ResolvedProject } from './compose.js';
import type { Paper } from './journal-checks.js';

export function createMystEdge(): MystEdge {
  /**
   * One Session per config file [R71]. `configFiles` makes myst read the derived config and
   * ignore the author's `myst.yml`. `build` and a composed `validate` read the derived config; a
   * `validate` with nothing to compose reads the author's [R82].
   */
  const sessions = new Map<string, Session>();
  const sessionFor = (configFile?: string): Session => {
    const key = configFile ?? '';
    let s = sessions.get(key);
    if (!s) {
      s = configFile ? new Session({ configFiles: [configFile] }) : new Session();
      sessions.set(key, s);
    }
    return s;
  };

  return {
    async loadProject(dir: string, configFile?: string): Promise<ResolvedProject> {
      const res = await loadConfig(sessionFor(configFile), dir);
      return (res?.project ?? {}) as ResolvedProject;
    },
    async build(dir, opts, configFile, afterExports): Promise<void> {
      const session = sessionFor(configFile);
      const prev = process.cwd();
      process.chdir(dir);
      try {
        // As the myst CLI does; without it `build --html` finds no site.
        await findCurrentProjectAndLoad(session, dir);
        // An exports-only build skips the site, which downloads the theme zip.
        const site = !opts.exportsOnly;
        if (site) await findCurrentSiteAndLoad(session, dir);

        // myst's `build` logs a failed export and carries on, and its HTML build ends the
        // process, so oak runs the exports itself and reports them before the site.
        const exports =
          opts.exportsOnly || opts.all
            ? await collectAllBuildExportOptions(session, [], { all: true })
            : [];
        let error: string | undefined;
        if (exports.length) {
          try {
            await localArticleExport(session, exports, { throwOnFailure: true });
          } catch (e) {
            error = String((e as Error)?.message ?? e)
              .replace(/\s+/g, ' ')
              .trim();
          }
        }
        afterExports?.({
          exports: exports.map((e) => ({ id: e.id, format: e.format, output: e.output })),
          error,
        });

        // Given no format, myst's `build` runs no exports, only the site. It disposes the session
        // when it ends, closing any Jupyter kernel.
        if (site) await build(session, [], { html: opts.html });
        else session.dispose();
      } finally {
        process.chdir(prev);
      }
    },
    async start(dir: string, opts: StartOpts, configFile?: string): Promise<void> {
      const session = sessionFor(configFile);
      // Permanent, unlike build's: the server keeps running and resolves paths from cwd, and oak
      // does nothing after this.
      process.chdir(dir);
      // Without these the server has no site to serve.
      await findCurrentProjectAndLoad(session, dir);
      await findCurrentSiteAndLoad(session, dir);
      await startServer(session, opts);
    },
    async withProjectSession<T>(
      dir: string,
      fn: (session: ISession) => Promise<T>,
      configFile?: string,
    ): Promise<T> {
      // `oak validate` passes the derived config, so the checks read what gets published [R82].
      // It passes none when there is nothing to compose.
      const session = sessionFor(configFile);
      const prev = process.cwd();
      process.chdir(dir);
      try {
        // The curvenote checks read the project from cwd, so cwd must be the paper root.
        // Processing to mdast without writing files is enough for the frontmatter and abstract
        // checks.
        await findCurrentProjectAndLoad(session, '.');
        await processProject(session, { path: '.' }, { writeFiles: false, writeTOC: false });
        return await fn(session);
      } finally {
        process.chdir(prev);
      }
    },
    paperForChecks(session: ISession, root: string): Paper {
      const state = session.store.getState();
      const project = selectors.selectLocalProject(state, root);
      if (!project) throw new Error(`myst has no processed project at ${root}`);
      // `filterPages` puts the index page first.
      const pages = filterPages(project).map(({ file }) => {
        const data = selectFile(session, file);
        if (!data) throw new Error(`myst has not processed ${file}`);
        // `file` is relative to the paper root, the cwd `withProjectSession` loaded it from.
        return { file: resolve(root, file), frontmatter: data.frontmatter, mdast: data.mdast };
      });
      return {
        root,
        project: selectors.selectLocalProjectConfig(state, root) ?? {},
        pages,
        toText,
        selectAll,
      };
    },
  };
}
