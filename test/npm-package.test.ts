/**
 * The tarball `npm pack` makes, unpacked and run. `files` in package.json is an allowlist and npm
 * strips some names on its own, so this checks the templates bootstrap stamps all made it in,
 * and runs the unpacked bundle. Skipped without `dist/cli.cjs` (bundle-state.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleState, assertBundleNotStale, bundlePath } from './bundle-state.js';

const engineDir = fileURLToPath(new URL('..', import.meta.url));

/** A `files` glob as a RegExp over a repo-relative path; `*` stays within one path segment. */
function globRegExp(glob: string): RegExp {
  const body = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${body}$`);
}

describe.skipIf(bundleState() === 'absent')('the npm tarball', () => {
  let pkgDir: string;
  beforeAll(() => {
    assertBundleNotStale();
    const dir = mkdtempSync(join(tmpdir(), 'oak-npm-pack-'));
    // --ignore-scripts: prepack would rebuild the bundle `npm test` just built.
    execFileSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', dir], {
      cwd: engineDir,
      stdio: 'ignore',
    });
    const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    if (!tarball) throw new Error(`npm pack wrote no tarball to ${dir}`);
    execFileSync('tar', ['-xzf', join(dir, tarball), '-C', dir]);
    pkgDir = join(dir, 'package');
  });

  it('carries every tracked file under templates/ that `files` includes', () => {
    const files = (
      JSON.parse(readFileSync(join(engineDir, 'package.json'), 'utf8')) as {
        files: string[];
      }
    ).files;
    const excluded = files.filter((f) => f.startsWith('!')).map((f) => globRegExp(f.slice(1)));
    const tracked = execFileSync('git', ['ls-files', '-z', 'templates'], {
      cwd: engineDir,
      encoding: 'utf8',
    })
      .split('\0')
      .filter((rel) => rel && !excluded.some((re) => re.test(rel)));
    expect(tracked.length).toBeGreaterThan(0);
    const packed = new Set(
      readdirSync(join(pkgDir, 'templates'), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name).slice(pkgDir.length + 1)),
    );
    expect(tracked.filter((rel) => !packed.has(rel))).toEqual([]);
  });

  it('runs `--version` from the unpacked copy, matching the bundle it was packed from', () => {
    const version = (cli: string) =>
      execFileSync('node', [cli, '--version'], { encoding: 'utf8' }).trim();
    expect(version(join(pkgDir, 'dist', 'cli.cjs'))).toBe(version(bundlePath));
  });

  it('runs `validate` on the fixture paper from the unpacked copy', () => {
    const paper = mkdtempSync(join(tmpdir(), 'oak-npm-pack-paper-'));
    cpSync(join(engineDir, 'test', 'fixture-paper'), paper, {
      recursive: true,
      filter: (src) => !src.endsWith('myst.oak.yml'),
    });
    const r = spawnSync(
      'node',
      [
        join(pkgDir, 'dist', 'cli.cjs'),
        'validate',
        '--paper',
        paper,
        '--instance',
        join(engineDir, 'test', 'fixture-instance'),
        '--repo',
        'open-scholar-nexus/fixture-sample-paper',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    expect(r.status, `exit ${r.status}\n${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout).status).toBe('ok');
  }, 180_000);
});
