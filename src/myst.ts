/**
 * The only module that imports myst-cli, so the rest of oak is testable without it. oak calls
 * myst as a library, not a subprocess [design §7a].
 *
 * `loadConfig` alone does not set the current site and project, which `build` needs for HTML
 * ("No site configuration found"). So each call first runs `findCurrentProjectAndLoad` and
 * `findCurrentSiteAndLoad`, as the myst CLI does [R59].
 */
import {
  Session,
  loadConfig,
  build,
  startServer,
  processProject,
  findCurrentProjectAndLoad,
  findCurrentSiteAndLoad,
} from 'myst-cli';
import type { ISession } from 'myst-cli';
import type { MystEdge, BuildOpts, StartOpts } from './materialize.js';
import type { ResolvedProject } from './compose.js';

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
    async build(dir: string, opts: BuildOpts, configFile?: string): Promise<void> {
      const session = sessionFor(configFile);
      const prev = process.cwd();
      process.chdir(dir);
      try {
        // As the myst CLI does; without it `build --html` finds no site.
        await findCurrentProjectAndLoad(session, dir);
        if (opts.exportsOnly) {
          // Offline: the typst export only, since HTML needs the theme zip from the network.
          await build(session, [], { typst: true } as Parameters<typeof build>[2]);
        } else {
          await findCurrentSiteAndLoad(session, dir);
          await build(session, [], { all: opts.all, html: opts.html });
        }
      } finally {
        process.chdir(prev);
      }
    },
    async start(dir: string, opts: StartOpts, configFile?: string): Promise<void> {
      const session = sessionFor(configFile);
      // Permanent, unlike build's: the server keeps running and resolves paths from cwd, and oak
      // does nothing after this.
      process.chdir(dir);
      // Without these the server has no site to serve [R59].
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
        // The curvenote checks read the project from cwd, so cwd must be the paper root [R59].
        // Processing to mdast without writing files is enough for the frontmatter and abstract
        // checks.
        await findCurrentProjectAndLoad(session, '.');
        await processProject(session, { path: '.' }, { writeFiles: false, writeTOC: false });
        return await fn(session);
      } finally {
        process.chdir(prev);
      }
    },
  };
}
