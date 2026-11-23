/**
 * papers.ts: `oak papers`, the papers a workflow run works on. The launchers run it in a first
 * job, holding no secret, and later jobs read the list or the one folder from its result, so
 * the selection lives in the engine and the workflows depend only on the result's shape.
 *
 * The changed files are injected, so tests need no git.
 */
import { posix } from 'node:path';
import * as msg from './messages.js';
import { err, ok, type Outcome } from './result.js';
import { listedFolderIds } from './assemble.js';
import {
  discoverProjects,
  folderId,
  isColocated,
  PAPER_ID,
  PAPERS_DIR,
  parsePaperTag,
} from './projects.js';

/** What `oak papers` selects for. */
export type PapersMode =
  { for: 'build' | 'check'; event: string } | { tag: string } | { id: string };

/** One paper in the result: its folder and the id that names its artifacts (`''` for `.`). */
export interface PaperEntry {
  dir: string;
  key: string;
}

const entry = (dir: string): PaperEntry => ({ dir, key: folderId(dir) ?? '' });

/**
 * The papers for one run, as `{ colocated, papers, count }`, and `paper_dir` for one paper
 * named by a tag or an id.
 *
 *   - `--for build`: on a pull request the papers it changes, else the papers
 *     `registry/papers.yml` lists (drafts are not built on a push).
 *   - `--for check`: on a pull request the papers it changes, or every paper when it changes
 *     anything outside `papers/`, else every paper.
 *   - `--tag`: the paper a version tag names ({@link parsePaperTag}), which must exist.
 *   - `--id`: the paper with that folder, or the one at the root in a paper repository when the
 *     id is empty.
 *
 * A paper repository has one paper, `.`, whatever the mode. `changed` lists the pull request's
 * changed files; it is only called on a pull request.
 */
export function selectPapers(root: string, mode: PapersMode, changed: () => string[]): Outcome {
  const colocated = isColocated(root);
  const all = discoverProjects(root);
  const result = (dirs: string[], extra: Record<string, unknown> = {}) =>
    ok({ colocated, papers: dirs.map(entry), count: dirs.length, ...extra });

  if ('tag' in mode) {
    const tag = parsePaperTag(mode.tag);
    if (!tag || (tag.id !== null) !== colocated || !all.includes(tag.paperDir)) {
      return err(2, msg.papers.tagNamesNoPaper(mode.tag, colocated));
    }
    return result([tag.paperDir], { paper_dir: tag.paperDir });
  }
  if ('id' in mode) {
    if (!colocated) {
      if (mode.id) return err(2, msg.papers.idInPaperRepo);
      return result(['.'], { paper_dir: '.' });
    }
    const dir = posix.join(PAPERS_DIR, mode.id);
    if (!PAPER_ID.test(mode.id) || !all.includes(dir)) return err(2, msg.papers.unknownId(mode.id));
    return result([dir], { paper_dir: dir });
  }

  if (!colocated) return result(['.']);
  if (mode.event === 'pull_request') {
    const files = changed();
    if (mode.for === 'check' && files.some((f) => !f.startsWith(`${PAPERS_DIR}/`))) {
      return result(all);
    }
    return result(all.filter((dir) => files.some((f) => f.startsWith(`${dir}/`))));
  }
  if (mode.for === 'build') {
    const listed = new Set(listedFolderIds(root));
    return result(all.filter((dir) => listed.has(folderId(dir)!)));
  }
  return result(all);
}
