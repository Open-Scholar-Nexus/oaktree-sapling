/**
 * add-paper.ts: `oak add-paper`, an author's submission of interest to a co-located journal.
 * It forks the journal's repository, seeds `papers/<id>/` from the starter manuscript on a
 * branch of the fork, and opens the pull request; an editor merges it as a draft.
 *
 * It runs on the author's machine with their own gh login. git and gh are injected, so tests
 * need neither.
 */
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import * as msg from './messages.js';
import { readDoc, readJournalConfig, writeDoc } from './yaml-io.js';
import { renderPaperTemplate, ENGINE_VERSION_KEY } from './bootstrap.js';
import {
  ENGINE_MANAGED_PATHS,
  EDITION_ID,
  ENGINE_VERSION,
  checkIdShape,
  underPaths,
} from './schema.js';
import { isColocated, PAPER_ID, PAPERS_DIR } from './projects.js';
import { err, type Outcome } from './result.js';

/** The calls `oak add-paper` makes through git and gh; the real ones are in gh.ts. */
export interface AddPaperGh {
  /** The logged-in gh user. */
  authedUser(): string;
  /** A clone of `repo` on a new `branch` started at its default branch. */
  checkout(repo: string, branch: string): string;
  /** Forks `repo` to the user's account, or finds the fork already there; returns its name. */
  fork(repo: string): string;
  /** Commits everything under `paths` in the clone and pushes `branch` to `forkRepo`. */
  commitAndPush(
    dir: string,
    forkRepo: string,
    branch: string,
    paths: string[],
    message: string,
  ): void;
  /** Opens the pull request from `head` (`user:branch`) into `repo`; returns its URL. */
  openPr(repo: string, opts: { head: string; title: string; body: string }): string;
}

export interface AddPaperInput {
  repo: string;
  id: string;
  /** Defaults to the year in the id ({@link defaultEdition}). */
  edition?: string;
  /** `templates/paper/` in oak's checkout. */
  paperTemplateRoot: string;
}

export interface AddPaperDeps {
  gh: AddPaperGh;
  log(line: string): void;
  confirm(plan: string[]): Promise<boolean>;
}

/** The edition an id names by its year, as in `smith-2026-title`: the first four-digit group
 *  between dashes, or undefined. A default, shown in the plan, which `--edition` replaces. */
export function defaultEdition(id: string): string | undefined {
  return /(?:^|-)(\d{4})(?:-|$)/.exec(id)?.[1];
}

/**
 * Writes the starter manuscript into `<repoRoot>/papers/<id>/`: the paper template without the
 * launchers, which the repository already has, with the id, the edition, the engine version the
 * repository runs and its GitHub URL in `myst.yml`. Returns the written paths, repo-relative.
 */
export function seedPaper(
  paperTemplateRoot: string,
  repoRoot: string,
  opts: { id: string; edition: string; version: string; repo: string },
): string[] {
  const dir = posix.join(PAPERS_DIR, opts.id);
  const written = renderPaperTemplate(
    paperTemplateRoot,
    join(repoRoot, dir),
    {
      engineRepo: '',
      journalRepo: '.',
      owner: '',
      version: opts.version,
      edition: opts.edition,
      repo: opts.repo,
    },
    (rel) => !underPaths(ENGINE_MANAGED_PATHS, rel),
  );
  const myst = join(repoRoot, dir, 'myst.yml');
  const doc = readDoc(myst);
  doc.setIn(['project', 'id'], opts.id);
  writeDoc(myst, doc);
  return written.map((rel) => posix.join(dir, rel));
}

/** `oak add-paper --repo <owner/name> --id <id>`. Documented at DOCS.colocated. */
export async function cmdAddPaper(input: AddPaperInput, deps: AddPaperDeps): Promise<Outcome> {
  const { repo, id } = input;
  if (!PAPER_ID.test(id)) return err(2, msg.addPaper.badId(id));
  const edition = input.edition ?? defaultEdition(id);
  if (!edition) return err(2, msg.addPaper.noEdition(id));
  if (!EDITION_ID.safeParse(edition).success) return err(2, msg.addPaper.badEdition(edition));

  const { gh } = deps;
  const user = gh.authedUser();
  const branch = `add-${id}`;
  const dir = gh.checkout(repo, branch);

  // Checked on the journal's own default branch, as the pull request's checks will.
  if (!isColocated(dir)) return err(2, msg.addPaper.notColocated(repo));
  const journal = readJournalConfig(dir);
  const shape = checkIdShape(id, journal ?? {});
  if (!shape.ok) return err(2, msg.addPaper.idRefused(shape.message));
  const paperDir = posix.join(PAPERS_DIR, id);
  if (existsSync(join(dir, paperDir))) return err(2, msg.addPaper.idTaken(id, repo));
  if (!existsSync(join(dir, 'editions', `${edition}.yml`))) {
    return err(2, msg.addPaper.unknownEdition(edition, repo, input.edition !== undefined));
  }
  const pins = join(dir, '.github', 'actions', 'engine', 'pins.yml');
  const version = existsSync(pins) ? readDoc(pins).get(ENGINE_VERSION_KEY) : undefined;
  if (typeof version !== 'string' || !ENGINE_VERSION.test(version)) {
    return err(2, msg.addPaper.noEngineVersion(repo));
  }

  const plan = [
    msg.addPaper.planHeader(repo, id),
    msg.addPaper.planEdition(edition, input.edition !== undefined),
    msg.addPaper.planFork(`${user}/${repo.split('/')[1]}`, branch),
    msg.addPaper.planSeed(paperDir, version),
    msg.addPaper.planPr(repo),
  ];
  if (!(await deps.confirm(plan))) {
    return { exitCode: 0, result: { status: 'aborted', repo, id, reason: msg.addPaper.aborted } };
  }

  const written = seedPaper(input.paperTemplateRoot, dir, { id, edition, version, repo });
  const forkRepo = gh.fork(repo);
  gh.commitAndPush(dir, forkRepo, branch, [paperDir], msg.addPaper.commitMessage(id));
  deps.log(msg.addPaper.logPushed(forkRepo, branch));
  const pr = gh.openPr(repo, {
    head: `${user}:${branch}`,
    title: msg.addPaper.prTitle(id),
    body: msg.addPaper.prBody(id, paperDir),
  });
  deps.log(msg.addPaper.logPrOpened(pr));
  return {
    exitCode: 0,
    result: { status: 'ok', repo, id, edition, fork: forkRepo, branch, pr, files: written },
  };
}
