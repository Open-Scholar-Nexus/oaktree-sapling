/**
 * `oak clean` (clean.ts) over a real folder standing in for the temporary folder: only folders
 * of the user's named `oak-release-*` count, and never a symlink.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clonePrefix, cmdClean, findKeptClones, removeKeptClones } from '../src/clean.js';

const uid = process.getuid?.();

/** A folder named `name` in `dir` holding a file. */
function clone(dir: string, name: string) {
  const path = join(dir, name);
  mkdirSync(path);
  writeFileSync(join(path, 'myst.yml'), 'version: 1\n');
  return path;
}

const tmp = () => mkdtempSync(join(tmpdir(), 'oak-clean-test-'));

describe('oak clean finds the clones oak release kept', () => {
  it('lists a folder named oak-release-*, and no other', () => {
    const dir = tmp();
    const path = clone(dir, 'oak-release-abc');
    clone(dir, 'other');
    expect(findKeptClones(dir, uid)).toEqual([path]);
  });

  it("skips a symlink named like a clone and another user's folder", () => {
    const dir = tmp();
    const target = clone(tmp(), 'target');
    symlinkSync(target, join(dir, 'oak-release-link'));
    expect(findKeptClones(dir, uid)).toEqual([]);

    const other = tmp();
    clone(other, 'oak-release-abc');
    expect(findKeptClones(other, (uid ?? 0) + 1)).toEqual([]);
  });
});

describe('oak clean removes them once confirmed', () => {
  const run = async (dir: string, cacheDir: string, cache: boolean, yes: boolean) => {
    const logs: string[] = [];
    const plans: string[][] = [];
    const out = await cmdClean(
      { dir, cacheDir, cache },
      {
        uid,
        confirm: async (plan) => {
          plans.push(plan);
          return yes;
        },
        log: (line) => void logs.push(line),
      },
    );
    return { out, logs, plans };
  };

  it('declined, it is a listing and removes nothing', async () => {
    const dir = tmp();
    const path = clone(dir, 'oak-release-abc');
    const { plans } = await run(dir, tmp(), false, false);
    expect(plans[0]!.join('\n')).toMatch(`${path}: `);
    expect(existsSync(path)).toBe(true);
  });

  it('confirmed, it removes the clones and keeps the cache without --cache', async () => {
    const dir = tmp();
    const path = clone(dir, 'oak-release-abc');
    const cacheDir = tmp();
    writeFileSync(join(cacheDir, 'x'), 'cached');
    const { out, logs } = await run(dir, cacheDir, false, true);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(cacheDir)).toBe(true);
    expect(logs.join('\n')).toContain('--cache removes it');
    expect(out.result).toMatchObject({ status: 'ok', removed: true });
  });

  it('removes the cache with --cache', async () => {
    const cacheDir = tmp();
    writeFileSync(join(cacheDir, 'x'), 'cached');
    const { plans } = await run(tmp(), cacheDir, true, true);
    expect(plans[0]!.join('\n')).toContain('the pinned oak versions');
    expect(existsSync(cacheDir)).toBe(false);
  });

  it('with nothing to remove, says which folder it searched and asks nothing', async () => {
    const dir = tmp();
    const { logs, plans } = await run(dir, join(dir, 'no-cache'), false, true);
    expect(logs.join('\n')).toContain(`no clones kept by oak release in ${dir}`);
    expect(plans).toEqual([]);
  });
});

describe('a successful oak release removes the clones kept for its repo and tag', () => {
  it('only those', () => {
    const dir = tmp();
    const same = clone(dir, clonePrefix('o/paper', 'v1.0.0') + 'abcdef');
    const otherTag = clone(dir, clonePrefix('o/paper', 'v1.0.0-dev.1') + 'abcdef');
    const otherRepo = clone(dir, clonePrefix('o/paper_v1.0.0', 'v2.0.0') + 'abcdef');
    const download = clone(dir, 'oak-release-build-abcdef');
    expect(removeKeptClones(dir, 'o/paper', 'v1.0.0', uid)).toEqual([same]);
    expect([otherTag, otherRepo, download].map(existsSync)).toEqual([true, true, true]);
  });
});
