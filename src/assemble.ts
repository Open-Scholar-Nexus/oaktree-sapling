/**
 * assemble.ts: `oak assemble`, the journal website of a co-located repository with each listed
 * paper mounted at `/<id>/`.
 *
 * Each paper is built in a job of its own, with its own `BASE_URL`, so one paper's plugins cannot
 * alter another's output; this runs in a job that runs no paper code, and only copies their
 * built sites into the journal's. The journal site is built with its own toolchain (its
 * `package.json`), as on an external journal's website. The build is injected, so tests need
 * neither npm nor myst.
 */
import { cpSync, existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { readDoc } from './yaml-io.js';
import { parseLocation, readRegistry } from './schema.js';
import { PAPER_ID } from './projects.js';
import { SITE_FILES } from './artifact.js';
import { err, ok, type Outcome } from './result.js';

/** One paper's built site (`_build/html`), and the id it is mounted under. */
export interface PaperBuild {
  id: string;
  dir: string;
}

/** The prefix of a paper build's artifact name in a co-located repository: `paper-build-<id>`. */
export const BUILD_ARTIFACT_PREFIX = 'paper-build-';

/**
 * The paper builds Stage 1 left in `dir`, one folder per artifact named
 * `paper-build-<id>`. A folder by any other name, or whose id is not a {@link PAPER_ID}, is
 * refused. When one artifact matches, the download puts its site in `dir` itself; it is then
 * the build of the one paper in `listed`. The id never comes from the build's own files, which
 * the paper's code wrote.
 */
export function readBuilds(dir: string, listed: string[]): PaperBuild[] {
  if (!existsSync(dir)) return [];
  if (existsSync(join(dir, 'index.html'))) {
    if (listed.length !== 1) throw new UserError(msg.assemble.oneBuild(listed.length));
    return [{ id: listed[0]!, dir }];
  }
  return readdirSync(dir)
    .sort()
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .map((name) => {
      const id = name.startsWith(BUILD_ARTIFACT_PREFIX)
        ? name.slice(BUILD_ARTIFACT_PREFIX.length)
        : '';
      if (!PAPER_ID.test(id)) throw new UserError(msg.assemble.badBuildFolder(name));
      return { id, dir: join(dir, name) };
    });
}

/** The ids of the papers `registry/papers.yml` lists in this repository's `papers/` folder, in
 *  registry order. A listed folder's name is its id (`oak validate` holds them equal). */
export function listedFolderIds(siteRoot: string): string[] {
  const path = join(siteRoot, 'registry', 'papers.yml');
  if (!existsSync(path)) return [];
  const read = readRegistry(readDoc(path).toJS());
  if (!read) throw new UserError(msg.assemble.registryNotList);
  const ids: string[] = [];
  for (const entry of read.entries) {
    const location = parseLocation(entry.location);
    if (!location || !('path' in location)) continue;
    const m = /^\.\/papers\/([^/]+)\/?$/.exec(location.path);
    if (m && PAPER_ID.test(m[1]!)) ids.push(m[1]!);
  }
  return ids;
}

export interface AssembleDeps {
  /** Builds the journal site at `siteRoot` into `<siteRoot>/_build/html`, served from
   *  `baseUrl`; throws a UserError naming the fault. */
  buildSite(siteRoot: string, baseUrl: string): void;
  log(line: string): void;
}

/**
 * Builds the journal website at `siteRoot` and mounts each listed paper's build at `/<id>/`.
 * Every listed paper needs a build, since the deploy replaces the whole site; a paper with a
 * build that the registry does not list is left out. Fails before building on a missing build,
 * and refuses a paper id that is also the name of something the site itself serves.
 */
export function assemble(
  builds: PaperBuild[],
  input: { siteRoot: string; baseUrl: string },
  deps: AssembleDeps,
): Outcome {
  const { siteRoot, baseUrl } = input;
  const listed = listedFolderIds(siteRoot);
  const byId = new Map(builds.map((b) => [b.id, b]));
  const missing = listed.filter((id) => !byId.has(id));
  if (missing.length) return err(2, msg.assemble.missingBuilds(missing));
  for (const b of builds) {
    if (!listed.includes(b.id)) deps.log(msg.assemble.unlisted(b.id));
  }

  deps.buildSite(siteRoot, baseUrl);
  const html = join(siteRoot, '_build', 'html');
  if (!existsSync(join(html, 'index.html'))) return err(2, msg.assemble.noSite(html));

  for (const id of listed) {
    const target = join(html, id);
    if (existsSync(target)) return err(2, msg.assemble.clash(id));
    cpSync(byId.get(id)!.dir, target, {
      recursive: true,
      filter: (src) => !lstatSync(src).isSymbolicLink(),
    });
    // A push build writes neither, and the site is served.
    for (const name of Object.values(SITE_FILES)) rmSync(join(target, name), { force: true });
    deps.log(msg.assemble.mounted(id, `${baseUrl}/${id}/`));
  }
  return ok({ site: html, papers: listed });
}

/**
 * The real site build: `npm install` from the site's own `package.json`, then its `myst build
 * --html --strict` with `BASE_URL`. myst exits 0 when a plugin never loaded or a file did not
 * resolve, so the log is read for both, as the external journal's site workflow does.
 */
export function npmSiteBuild(siteRoot: string, baseUrl: string): void {
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, {
      cwd: siteRoot,
      encoding: 'utf8',
      env: { ...process.env, BASE_URL: baseUrl },
      maxBuffer: 64 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    process.stderr.write(out);
    if (r.error || r.status !== 0) {
      throw new UserError(msg.assemble.stepFailed(`${cmd} ${args.join(' ')}`, r.status));
    }
    return out;
  };
  run('npm', ['install', '--no-audit', '--no-fund']);
  const log = run('npx', ['myst', 'build', '--html', '--strict']);
  if (!/Paper Gallery.*loaded/.test(log)) throw new UserError(msg.assemble.galleryNotLoaded);
  if (/unable to resolve file/.test(log)) throw new UserError(msg.assemble.fileUnresolved);
}
