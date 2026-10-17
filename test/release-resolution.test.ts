/**
 * Which release of oak a repo gets by default: `oak upgrade` without `--to`. It writes it into the
 * repo, and a dev release will be deleted when pruned (RELEASING.md), so it must be a stable one.
 * `oak bootstrap` pins the running oak's own version, and looks the newest release up only to say
 * when a newer one exists (engine-version.test.ts).
 *
 * `latestEngineRelease` must use `repos/<repo>/releases/latest`, the newest release that is
 * neither a draft nor a pre-release; `gh release list --limit 1` sorts by date and includes
 * pre-releases. This reads the source, like `messages.test.ts`, since the real lookup needs the
 * network.
 *
 * A repo with only pre-releases has no stable release, so the message says that, not "no
 * releases", and names the flag that picks a pre-release.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as msg from '../src/messages.js';

const srcDir = join(fileURLToPath(new URL('..', import.meta.url)), 'src');

/** The body of `latestEngineRelease`, from its signature to its closing brace. */
function resolverBody(): string {
  const src = readFileSync(join(srcDir, 'gh.ts'), 'utf8');
  const start = src.indexOf('export function latestEngineRelease');
  expect(start, 'latestEngineRelease has been renamed or removed').toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  return src.slice(start, end);
}

describe('the release a repo gets by default', () => {
  it('resolves through releases/latest, which excludes pre-releases', () => {
    const body = resolverBody();
    expect(body).toContain('releases/latest');
  });

  it('never resolves by taking the first of a date-sorted release list', () => {
    // `gh release list --limit 1` returns a dev release.
    const body = resolverBody();
    expect(body).not.toMatch(/'release',\s*'list'/);
    expect(body).not.toContain('--limit');
  });

  it('tells a repo with only pre-releases how to name one', () => {
    // "no releases" would contradict the releases page.
    const m = msg.workflow.noStableRelease('me/engine');
    expect(m).not.toMatch(/no releases found/);
    expect(m).toMatch(/pre-release/);
    expect(m).toMatch(/--to <tag>/);
  });
});
