/**
 * The paper commands' handoff to the pinned oak (src/pinned.ts), with a fake clone and spawner,
 * so nothing here touches the network or runs another oak.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheHome, handOff, USE_RUNNING_ENV, type HandoffDeps } from '../src/pinned.js';

const DEFAULT_REPO = 'Open-Scholar-Nexus/oaktree-sapling';

function paper(version: string | null, engineRepo?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'oak-pinned-paper-'));
  const pin = version === null ? '' : `      version: ${version}\n`;
  writeFileSync(
    join(dir, 'myst.yml'),
    `version: 1\nproject:\n  options:\n    oaktree-sapling:\n${pin}      edition: e\n`,
  );
  if (engineRepo !== undefined) {
    mkdirSync(join(dir, '.github', 'actions', 'engine'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'actions', 'engine', 'pins.yml'),
      `engine_repo: ${JSON.stringify(engineRepo)}\n`,
    );
  }
  return dir;
}

/** Fakes that record calls; the clone writes a build unless `withBuild` is false. */
function fakes(opts: { withBuild?: boolean; confirm?: boolean; typst?: boolean } = {}) {
  const calls = {
    clones: [] as string[][],
    spawns: [] as { cli: string; argv: string[]; env: NodeJS.ProcessEnv }[],
    confirms: 0,
    log: [] as string[],
  };
  const deps: HandoffDeps = {
    clone(engineRepo, tag, dest) {
      calls.clones.push([engineRepo, tag]);
      if (opts.withBuild !== false) {
        mkdirSync(join(dest, 'dist'), { recursive: true });
        writeFileSync(join(dest, 'dist', 'cli.cjs'), '');
      }
    },
    typstRuns: () => opts.typst ?? false,
    spawn(cli, argv, env) {
      calls.spawns.push({ cli, argv, env });
      return 7;
    },
    async confirm() {
      calls.confirms++;
      return opts.confirm ?? true;
    },
    log: (line) => calls.log.push(line),
  };
  return { deps, calls };
}

function ctx(paperRoot: string, argv: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return {
    verb: 'build' as const,
    argv: ['--paper', paperRoot, ...argv],
    paperRoot,
    running: 'v1.0.0',
    defaultRepo: DEFAULT_REPO,
    env,
    cacheRoot: mkdtempSync(join(tmpdir(), 'oak-pinned-cache-')),
  };
}

describe('handOff', () => {
  it('runs this oak when the paper pins its version', async () => {
    const { deps, calls } = fakes();
    expect(await handOff(ctx(paper('v1.0.0')), deps)).toBeNull();
    expect(calls.clones).toEqual([]);
  });

  it('runs this oak when there is no readable pin', async () => {
    const { deps, calls } = fakes();
    expect(await handOff(ctx(paper(null)), deps)).toBeNull();
    expect(await handOff(ctx(mkdtempSync(join(tmpdir(), 'oak-not-a-paper-'))), deps)).toBeNull();
    expect(calls.clones).toEqual([]);
  });

  it('fetches a mismatched version once, then reuses the cache', async () => {
    const dir = paper('v2.0.0');
    const c = ctx(dir, ['--exports-only'], { PATH: '/usr/bin' });
    const { deps, calls } = fakes({ typst: true });
    expect(await handOff(c, deps)).toBe(7);
    expect(await handOff(c, deps)).toBe(7);
    expect(calls.clones).toEqual([[DEFAULT_REPO, 'v2.0.0']]);
    const cached = join(c.cacheRoot, 'oak', 'Open-Scholar-Nexus', 'oaktree-sapling', 'v2.0.0');
    expect(calls.spawns[1]).toEqual({
      cli: join(cached, 'dist', 'cli.cjs'),
      argv: ['build', '--paper', dir, '--exports-only'],
      env: { PATH: `${join(cached, 'bin')}:/usr/bin`, [USE_RUNNING_ENV]: '1' },
    });
    expect(calls.log.filter((l) => l.includes('downloading'))).toHaveLength(1);
    expect(calls.log.filter((l) => l.includes('running oak v2.0.0 from'))).toHaveLength(2);
    expect(calls.confirms).toBe(0);
    // Only the renamed clone is left: no temporary directory beside it.
    expect(readdirSync(join(cached, '..'))).toEqual(['v2.0.0']);
  });

  it('leaves PATH alone when the clone typst does not run here', async () => {
    const { deps, calls } = fakes({ typst: false });
    await handOff(ctx(paper('v2.0.0'), [], { PATH: '/usr/bin' }), deps);
    expect(calls.spawns[0]!.env.PATH).toBe('/usr/bin');
  });

  it('asks once before fetching from a non-default engine_repo', async () => {
    const declined = fakes({ confirm: false });
    expect(await handOff(ctx(paper('v2.0.0', 'someone/fork')), declined.deps)).toBe(2);
    expect(declined.calls.confirms).toBe(1);
    expect(declined.calls.clones).toEqual([]);

    const accepted = fakes({ confirm: true });
    const c = ctx(paper('v2.0.0', 'someone/fork'));
    expect(await handOff(c, accepted.deps)).toBe(7);
    expect(accepted.calls.clones).toEqual([['someone/fork', 'v2.0.0']]);
    // Already fetched, so nothing is asked the second time.
    await handOff(c, accepted.deps);
    expect(accepted.calls.confirms).toBe(1);
  });

  it('does not ask for the default engine_repo named in pins.yml', async () => {
    const { deps, calls } = fakes({ confirm: false });
    expect(await handOff(ctx(paper('v2.0.0', DEFAULT_REPO)), deps)).toBe(7);
    expect(calls.confirms).toBe(0);
  });

  it('rejects a malformed version or engine_repo before any git call', async () => {
    const bad: [string, string | undefined, RegExp][] = [
      ['main', undefined, /pin a release tag/],
      ['v1.2.3-rc.1', undefined, /pin a release tag/],
      ['v1.2.3; rm -rf /', undefined, /pin a release tag/],
      ['${{ github.ref }}', undefined, /pin a release tag/],
      ['v2.0.0', '../..', /must be owner\/name/],
      ['v2.0.0', 'owner/..', /must be owner\/name/],
      ['v2.0.0', 'https://github.com/a/b', /must be owner\/name/],
      ['v2.0.0', 'a/b/c', /must be owner\/name/],
      ['v2.0.0', '-owner/name', /must be owner\/name/],
      ['v2.0.0', 'owner/${x}', /must be owner\/name/],
    ];
    for (const [version, repo, why] of bad) {
      const { deps, calls } = fakes();
      await expect(handOff(ctx(paper(version, repo)), deps), `${version} ${repo}`).rejects.toThrow(
        why,
      );
      expect(calls.clones).toEqual([]);
    }
  });

  it('accepts a dev release tag', async () => {
    const { deps, calls } = fakes();
    expect(await handOff(ctx(paper('v0.3.0-dev.12')), deps)).toBe(7);
    expect(calls.clones).toEqual([[DEFAULT_REPO, 'v0.3.0-dev.12']]);
  });

  it('never hands off from a handed-off oak', async () => {
    const { deps, calls } = fakes();
    expect(await handOff(ctx(paper('v2.0.0'), [], { [USE_RUNNING_ENV]: '1' }), deps)).toBeNull();
    expect(calls.clones).toEqual([]);
  });

  it('--use-running keeps this oak', async () => {
    const { deps, calls } = fakes();
    expect(await handOff(ctx(paper('v2.0.0'), ['--use-running']), deps)).toBeNull();
    expect(calls.clones).toEqual([]);
  });

  it('refuses a ref with no build in the clone', async () => {
    const { deps, calls } = fakes({ withBuild: false });
    await expect(handOff(ctx(paper('v2.0.0')), deps)).rejects.toThrow(/has no build/);
    expect(calls.spawns).toEqual([]);
  });

  it('a failed clone leaves nothing in the cache to reuse', async () => {
    const c = ctx(paper('v2.0.0'));
    const { deps } = fakes();
    deps.clone = () => {
      throw new Error('git clone failed (exit 128): Remote branch v2.0.0 not found');
    };
    await expect(handOff(c, deps)).rejects.toThrow(/could not fetch oak v2.0.0.*not found/);
    const parent = join(c.cacheRoot, 'oak', 'Open-Scholar-Nexus', 'oaktree-sapling');
    expect(readdirSync(parent)).toEqual([]);
    expect(existsSync(join(parent, 'v2.0.0'))).toBe(false);
  });
});

describe('cacheHome', () => {
  it('uses an absolute XDG_CACHE_HOME, else ~/.cache', () => {
    expect(cacheHome({ XDG_CACHE_HOME: '/x/cache' }, '/home/a')).toBe('/x/cache');
    expect(cacheHome({ XDG_CACHE_HOME: 'rel' }, '/home/a')).toBe('/home/a/.cache');
    expect(cacheHome({}, '/home/a')).toBe('/home/a/.cache');
  });
});
