/**
 * Classifies an oak ref and decides whether a pull request may run it. A public repo's
 * `refs/pull/N/merge` also resolves inside it, so trust depends on the kind of ref, not only on
 * the repo [R196] [R41].
 *
 * Nothing calls this [R41]: the engine action's `refclass` step enforces the rule before the
 * checkout, since oak cannot judge the ref it was checked out at.
 */

export type RefClass = 'tag' | 'sha' | 'pr-merge' | 'branch';

const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const PR_MERGE = /^refs\/pull\/\d+\/merge$/;

export function classifyRef(ref: string): RefClass {
  if (SEMVER_TAG.test(ref)) return 'tag';
  if (FULL_SHA.test(ref)) return 'sha';
  if (PR_MERGE.test(ref)) return 'pr-merge';
  return 'branch';
}

export interface RefContext {
  /** true when the pull request comes from a fork. */
  isFork: boolean;
  /** A maintainer override, to run a raw SHA or PR ref. */
  allowlisted?: boolean;
}

export interface RefDecision {
  allowed: boolean;
  refClass: RefClass;
  /** true when CI must still check that the ref descends from a release or the default branch. */
  needsAncestryCheck: boolean;
  reason: string;
}

/**
 * Tags and branches pass here but still need CI's ancestry check. A SHA or a PR merge ref runs
 * only from a same-repo pull request or with the maintainer override, never from a fork
 * [R196].
 */
export function decideRef(ref: string, ctx: RefContext): RefDecision {
  const refClass = classifyRef(ref);
  if (refClass === 'tag' || refClass === 'branch') {
    return {
      allowed: true,
      refClass,
      needsAncestryCheck: true,
      reason: `${refClass} accepted; ancestry check required before trust`,
    };
  }
  // sha or pr-merge
  const permitted = !ctx.isFork || ctx.allowlisted === true;
  return {
    allowed: permitted,
    refClass,
    needsAncestryCheck: false,
    reason: permitted
      ? `${refClass} accepted for same-repo/allowlisted dogfooding`
      : `${refClass} refused from a fork PR (would run arbitrary engine code in CI)`,
  };
}
