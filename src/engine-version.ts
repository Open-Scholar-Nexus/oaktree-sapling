/**
 * engine-version.ts: the engine version `oak bootstrap` pins. It stamps the running oak's own
 * templates, so it pins the running oak's version unless `--engine-version` names another.
 */
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { compareEngineVersions, ENGINE_VERSION, isStableEngineVersion } from './schema.js';
import type { ResolvedFlags } from './bootstrap.js';

/** Whether `running` (the bundle's `OAK_VERSION`) is a stable release. A bundle built outside a
 *  release cut reports `<version>-unreleased+<sha>`, so it never is. */
export function isStableVersion(running: string): boolean {
  return isStableEngineVersion(`v${running}`);
}

/**
 * The tag to pin: `given` when set, else `v` + `running`. Throws a UserError when `given` is not
 * an {@link ENGINE_VERSION}, or when it is unset and `running` is not a stable release. Needs no
 * network, so it runs before the gh check.
 */
export function pinnedEngineVersion(
  given: string | undefined,
  running: string,
): { engineVersion: string; resolved: ResolvedFlags } {
  if (given !== undefined) {
    if (!ENGINE_VERSION.test(given))
      throw new UserError(msg.workflow.bootstrapBadEngineVersion(given));
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

/** The newest release when it is newer than `running`, else undefined, also when the lookup
 *  fails. */
export async function newerRelease(
  running: string,
  newest: () => Promise<string>,
): Promise<string | undefined> {
  let tag: string;
  try {
    tag = await newest();
  } catch {
    return undefined;
  }
  return (compareEngineVersions(tag, `v${running}`) ?? 0) > 0 ? tag : undefined;
}

/** The npm `latest` of oaktree-sapling as a tag. npm gets a release only after its conformance
 *  passed (RELEASING.md), so this is what `npx oaktree-sapling@latest` runs. */
export async function npmLatest(): Promise<string> {
  const res = await fetch('https://registry.npmjs.org/oaktree-sapling/latest', {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`npm registry: ${res.status}`);
  return `v${((await res.json()) as { version: string }).version}`;
}
