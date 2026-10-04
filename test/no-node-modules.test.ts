/**
 * `npx oaktree-sapling` runs without installing anything. `dist/cli.cjs` bundles every runtime
 * dependency [R51], so the package declares no `dependencies` and a first `npx` takes seconds.
 *
 * A `require` that esbuild left out goes unnoticed in every other test, since they run inside
 * this checkout, where its own `node_modules` resolves it. So this lays the package out as npm
 * publishes it, where no `node_modules` can be found, and runs `validate`: it starts a real
 * myst-cli session and runs the curvenote checks over the fixture paper, which `--help` would
 * not.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleState, assertBundleNotStale } from './bundle-state.js';

const engineDir = fileURLToPath(new URL('..', import.meta.url));
const fixturePaper = join(engineDir, 'test', 'fixture-paper');
const fixtureInstance = join(engineDir, 'test', 'fixture-instance');

/** Every ancestor of `dir`, innermost first: the directories node's resolver searches. */
function ancestors(dir: string): string[] {
  const chain: string[] = [];
  for (let d = dir; ; d = dirname(d)) {
    chain.push(d);
    if (d === parse(d).root) return chain;
  }
}

/**
 * Lays out the published package: the `files` entries from package.json, in a new temporary
 * directory. `engineRoot()` finds its files by looking up from the bundle for `paper-base.yml`,
 * so the whole layout must match.
 */
function stagePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oak-nonodemod-'));
  const pkg = JSON.parse(readFileSync(join(engineDir, 'package.json'), 'utf8'));
  for (const entry of pkg.files as string[]) {
    if (entry.startsWith('!')) continue; // excluded at publish; nothing to copy
    const rel = entry.replace(/\/$/, '');
    const from = join(engineDir, rel);
    if (existsSync(from)) cpSync(from, join(dir, rel), { recursive: true });
  }
  cpSync(fixturePaper, join(dir, 'paper'), { recursive: true });
  // The journal repo picks the Layer B checks; with `--no-instance` the list is empty, which
  // would pass without loading them.
  cpSync(fixtureInstance, join(dir, 'instance'), { recursive: true });
  return dir;
}

describe.skipIf(bundleState() === 'absent')('the bundle runs with no node_modules', () => {
  let dir: string;
  beforeAll(() => {
    assertBundleNotStale();
    dir = stagePackage();
  });

  it('stages somewhere the resolver cannot reach a node_modules', () => {
    // Without this, a missing require would resolve from a `node_modules` higher up, as it
    // does inside the repo, and the tests below would prove nothing.
    const reachable = ancestors(dir).filter((d) => existsSync(join(d, 'node_modules')));
    expect(
      reachable,
      `temp dir ${dir} sits under a node_modules; this guard cannot work from here`,
    ).toEqual([]);
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
  });

  it('runs `validate` end to end: myst-cli session, Curvenote checks, exit 0', () => {
    const r = spawnSync(
      'node',
      [
        join(dir, 'dist', 'cli.cjs'),
        'validate',
        '--paper',
        join(dir, 'paper'),
        '--instance',
        join(dir, 'instance'),
        '--repo',
        'open-scholar-nexus/fixture-sample-paper',
        '--json',
      ],
      // NODE_PATH would give the resolver a directory outside the ones checked above.
      { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
    );
    const stderr = r.stderr ?? '';
    expect(stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
    expect(r.status, `exit ${r.status}\n${stderr}`).toBe(0);
    // myst-cli was bundled and ran.
    expect(stderr).toMatch(/building myst-cli session/);
    const out = JSON.parse(r.stdout ?? '');
    expect(out.status).toBe('ok');
    // The curvenote checks read myst's processed document, so a non-empty passing list means
    // myst ran in full inside the bundle.
    expect(out.checks.length).toBeGreaterThan(0);
    expect(out.checks.every((c: { status: string }) => c.status === 'pass')).toBe(true);
  }, 180_000);
});
