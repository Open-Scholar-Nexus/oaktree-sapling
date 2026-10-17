/**
 * engine-version.ts: the engine version `oak bootstrap` pins. It stamps the running oak's own
 * templates, so it pins the running oak's version unless `--engine-version` names another.
 */
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { compareTags } from './upgrade.js';
import type { ResolvedFlags } from './bootstrap.js';

/** A tag `--engine-version` accepts: a stable `vX.Y.Z` or a dev `vX.Y.Z-dev.N`. */
const ENGINE_TAG = /^v\d+\.\d+\.\d+(-dev\.\d+)?$/;

/** A stable version as `oak --version` reports it. A bundle built outside a release cut reports
 *  package.json's `0.0.0-unreleased`, so it never matches. */
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

/** Whether `running` (the bundle's `OAK_VERSION`) is a stable release. */
export function isStableVersion(running: string): boolean {
  return STABLE_VERSION.test(running);
}

/**
 * The tag to pin: `given` when set, else `v` + `running`. Throws a UserError when `given` is not
 * a release tag, or when it is unset and `running` is not a stable release. Needs no network, so
 * it runs before the gh check.
 */
export function pinnedEngineVersion(
  given: string | undefined,
  running: string,
): { engineVersion: string; resolved: ResolvedFlags } {
  if (given !== undefined) {
    if (!ENGINE_TAG.test(given)) throw new UserError(msg.workflow.bootstrapBadEngineVersion(given));
    return {
      engineVersion: given,
      resolved: { engineVersionFrom: 'flag', runningVersion: running },
    };
  }
  if (!isStableVersion(running)) throw new UserError(msg.workflow.bootstrapUnreleased(running));
  return {
    engineVersion: `v${running}`,
    resolved: { engineVersionFrom: 'running-oak', runningVersion: running },
  };
}

/** The newest stable release when it is newer than `running`, else undefined. A failed lookup
 *  is undefined too: the notice it feeds is advice, and the pin does not depend on it. */
export function newerRelease(running: string, newest: () => string): string | undefined {
  let tag: string;
  try {
    tag = newest();
  } catch {
    return undefined;
  }
  return (compareTags(tag, `v${running}`) ?? 0) > 0 ? tag : undefined;
}
