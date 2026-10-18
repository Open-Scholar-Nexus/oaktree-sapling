/**
 * `oak upgrade`, with fakes for gh and git: computeDrift resets to the template (no change, a
 * changed template, a file edited in the repo); a run sets the version and overwrites the
 * engine-managed files that differ; --files-only leaves the version; an up-to-date repo gets no
 * pull request; and the pull request's branch and paths.
 */
import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  cpSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import {
  renderCodeowners,
  codeownersColumns,
  renderPaperTemplate,
  type TemplateAnswers,
} from '../src/bootstrap.js';
import {
  computeDrift,
  extraFrozenFiles,
  readAnswers,
  cmdUpgrade,
  type UpgradePr,
  type UpgradeDeps,
  ownerFromCodeowners,
  MIN_ENGINE_KEY,
} from '../src/upgrade.js';

const TEMPLATE_ROOT = 'templates/paper';
const tmp = (p = 'oak-up-') => mkdtempSync(join(tmpdir(), p));

const answers: TemplateAnswers = {
  engineRepo: 'me/engine',
  instanceRepo: 'me/instance-config',
  owner: '@alice',
  version: 'v1.0.0',
  edition: 'ed-2026',
};

/** A paper repo on disk (the template's workflows and starter content) at version v1.0.0. */
function makeRepo(): string {
  const dir = tmp('oak-repo-');
  renderPaperTemplate(TEMPLATE_ROOT, dir, answers);
  return dir;
}

/* --------------------------------------------------------------------------
 * computeDrift
 * ------------------------------------------------------------------------ */

describe('computeDrift', () => {
  it('no difference when the repo matches the target', () => {
    const repo = makeRepo();
    expect(computeDrift(repo, TEMPLATE_ROOT, readAnswers(repo))).toEqual([]);
  });

  it('reports an engine-managed file that changed in the template', () => {
    const repo = makeRepo();
    const target = tmp('oak-tmpl-');
    cpSync(TEMPLATE_ROOT, target, { recursive: true });
    appendFileSync(join(target, '.github/workflows/build-paper.yml'), '\n# new template line\n');
    expect(computeDrift(repo, target, readAnswers(repo))).toEqual([
      '.github/workflows/build-paper.yml',
    ]);
  });

  it('keeps a second code owner the journal added [R126]', () => {
    const repo = makeRepo();
    const co = join(repo, 'CODEOWNERS');
    writeFileSync(co, readFileSync(co, 'utf8').replace(/@alice/g, '@org/editors @alice'));
    expect(computeDrift(repo, TEMPLATE_ROOT, readAnswers(repo))).toEqual([]);
  });

  it('keeps different owners on different paths [R126]', () => {
    // With one owner everywhere, keying owners by path would not show. An owner added to one
    // gated path stays on that path, and is not copied onto the others or onto CODEOWNERS.
    const repo = makeRepo();
    const co = join(repo, 'CODEOWNERS');
    writeFileSync(
      co,
      readFileSync(co, 'utf8').replace(
        '/.github/                @alice',
        '/.github/                @org/editors @alice',
      ),
    );
    expect(computeDrift(repo, TEMPLATE_ROOT, readAnswers(repo))).toEqual([]);
    const after = readFileSync(co, 'utf8');
    expect(after).toContain('/.github/                @org/editors @alice');
    expect(after).toMatch(/\/CODEOWNERS\s+@alice$/m);
  });

  it('uses the whole owner column for a path the repo lacks [R126]', () => {
    // Repos seeded before /paper-environment.yml was gated have no line for it, so the
    // template's line gets the owner read from the repo.
    const repo = makeRepo();
    const co = join(repo, 'CODEOWNERS');
    const older = readFileSync(co, 'utf8')
      .split('\n')
      .filter((l) => !l.includes('paper-environment.yml'))
      .join('\n')
      .replace(/@alice/g, '@org/editors @alice');
    writeFileSync(co, older);
    const rendered = renderCodeowners(
      readFileSync(join(TEMPLATE_ROOT, 'CODEOWNERS'), 'utf8'),
      ownerFromCodeowners(older),
      codeownersColumns(older),
    );
    expect(rendered).toMatch(/paper-environment\.yml\s+@org\/editors @alice$/m);
  });

  it('a reset of another file keeps a second code owner [R126]', async () => {
    const repo = makeRepo();
    const co = join(repo, 'CODEOWNERS');
    writeFileSync(co, readFileSync(co, 'utf8').replace(/@alice/g, '@org/editors @alice'));
    appendFileSync(join(repo, '.github/workflows/build-paper.yml'), '\n# hand edit\n');
    const { pr } = fakePr();
    await cmdUpgrade(
      { repoRoot: repo, filesOnly: true },
      deps(pr, 'v2.0.0', () => TEMPLATE_ROOT),
    );
    expect(readFileSync(co, 'utf8')).toContain('@org/editors @alice');
  });

  it('reports a file edited in the repo, to reset to the template', () => {
    const repo = makeRepo();
    appendFileSync(join(repo, '.github/workflows/deposit-version.yml'), '\n# hand edit\n');
    expect(computeDrift(repo, TEMPLATE_ROOT, readAnswers(repo))).toEqual([
      '.github/workflows/deposit-version.yml',
    ]);
  });
});

/* --------------------------------------------------------------------------
 * A fake pull request opener, and the deps
 * ------------------------------------------------------------------------ */

function fakePr() {
  const opened: Array<{ branch: string; paths: string[] }> = [];
  const pr: UpgradePr = {
    open(_root, o) {
      opened.push({ branch: o.branch, paths: o.paths });
      return { url: 'https://github.com/me/paper/pull/9', action: 'opened' };
    },
  };
  return { pr, opened };
}

function deps(pr: UpgradePr, target: string, materialize: () => string): UpgradeDeps {
  return {
    resolveTarget: () => target,
    materializeTemplate: materialize,
    pr,
    log: () => {},
    confirm: async () => true,
  };
}

/* --------------------------------------------------------------------------
 * cmdUpgrade
 * ------------------------------------------------------------------------ */

describe('an engine-managed file the target no longer ships [R143]', () => {
  const withRetired = () => {
    const repo = makeRepo();
    writeFileSync(join(repo, '.github/workflows/retired.yml'), 'on: push\njobs: {}\n');
    return repo;
  };

  it('is not a difference, but is reported', () => {
    const repo = withRetired();
    expect(computeDrift(repo, TEMPLATE_ROOT, readAnswers(repo))).toEqual([]);
    expect(extraFrozenFiles(repo, TEMPLATE_ROOT)).toEqual(['.github/workflows/retired.yml']);
  });

  it('is reported even when everything else is up to date', async () => {
    const repo = withRetired();
    const lines: string[] = [];
    const { pr } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo },
      {
        ...deps(pr, 'v1.0.0', () => TEMPLATE_ROOT),
        log: (m) => lines.push(m),
      },
    );
    expect(out.result.up_to_date).toBe(true);
    expect(out.result.extra).toEqual(['.github/workflows/retired.yml']);
    expect(lines.join('\n')).toContain('retired.yml');
  });

  it("leaves it on disk: it may be the repo's own", () => {
    const repo = withRetired();
    const { pr } = fakePr();
    return cmdUpgrade(
      { repoRoot: repo, filesOnly: true },
      deps(pr, 'v2.0.0', () => TEMPLATE_ROOT),
    ).then(() => {
      expect(existsSync(join(repo, '.github/workflows/retired.yml'))).toBe(true);
    });
  });
});

describe('cmdUpgrade', () => {
  it('--files-only overwrites only the engine-managed files that differ, not myst.yml', async () => {
    const repo = makeRepo();
    const mystBefore = readFileSync(join(repo, 'myst.yml'), 'utf8');
    const target = tmp('oak-tmpl-');
    cpSync(TEMPLATE_ROOT, target, { recursive: true });
    appendFileSync(join(target, '.github/workflows/build-paper.yml'), '\n# upgraded\n');

    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, filesOnly: true },
      deps(pr, 'v2.0.0', () => target),
    );
    expect(out.result.version_bumped).toBe(false);
    expect(out.result.drift).toEqual(['.github/workflows/build-paper.yml']);
    expect(readFileSync(join(repo, 'myst.yml'), 'utf8')).toBe(mystBefore); // version not changed
    expect(readFileSync(join(repo, '.github/workflows/build-paper.yml'), 'utf8')).toContain(
      '# upgraded',
    ); // resynced
    expect(opened[0]!.paths).toEqual(['.github/workflows/build-paper.yml']);
    expect(opened[0]!.paths.every((p) => p.startsWith('.github/') || p === 'CODEOWNERS')).toBe(
      true,
    );
  });

  it('sets the version and resets the files that differ, on a branch named after the tag', async () => {
    const repo = makeRepo();
    const target = tmp('oak-tmpl-');
    cpSync(TEMPLATE_ROOT, target, { recursive: true });
    appendFileSync(join(target, '.github/workflows/build-paper.yml'), '\n# upgraded\n');

    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo },
      deps(pr, 'v3.0.0', () => target),
    );
    expect(out.result.version_bumped).toBe(true);
    expect(out.result.drift).toEqual(['.github/workflows/build-paper.yml']);
    const myst = parseDocument(readFileSync(join(repo, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'options', 'oaktree-sapling', 'version'])).toBe('v3.0.0');
    expect(opened[0]!.paths).toContain('myst.yml');
    expect(opened[0]!.paths).toContain('.github/workflows/build-paper.yml');
    expect(opened[0]!.branch).toBe('oak/upgrade-v3.0.0');
  });

  it('a repo already at the target gets no pull request', async () => {
    const repo = makeRepo(); // version v1.0.0, workflows match the template
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo },
      deps(pr, 'v1.0.0', () => TEMPLATE_ROOT),
    );
    expect(out.result.up_to_date).toBe(true);
    expect(out.result.pr).toBeNull();
    expect(opened).toHaveLength(0);
  });
});

describe('the newest release', () => {
  /** A paper repo pinned at `pin`. */
  function pinned(pin: string): string {
    const repo = makeRepo();
    const myst = join(repo, 'myst.yml');
    const doc = parseDocument(readFileSync(myst, 'utf8'));
    doc.setIn(['project', 'options', 'oaktree-sapling', 'version'], pin);
    writeFileSync(myst, doc.toString());
    return repo;
  }

  it('never moves a pin back from a newer pre-release', async () => {
    const repo = pinned('v1.0.1-dev.2');
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo },
      deps(pr, 'v1.0.0', () => TEMPLATE_ROOT),
    );
    expect(out.result.pin_ahead).toBe(true);
    expect(opened).toHaveLength(0);
  });

  it('moves a pin that is not a release tag, which no engine runs', async () => {
    const { pr, opened } = fakePr();
    await cmdUpgrade(
      { repoRoot: pinned('main') },
      deps(pr, 'v2.0.0', () => TEMPLATE_ROOT),
    );
    expect(opened[0]!.branch).toBe('oak/upgrade-v2.0.0');
  });

  it('refuses a target that is not a release tag before fetching it', async () => {
    for (const to of ['main', 'v1.2.3-rc.1', '--upload-pack=x']) {
      const { pr, opened } = fakePr();
      const out = await cmdUpgrade(
        { repoRoot: makeRepo(), to },
        deps(pr, 'v2.0.0', () => {
          throw new Error('fetched');
        }),
      );
      expect(out.exitCode, to).toBe(2);
      expect(opened).toHaveLength(0);
    }
  });

  it('moves a pre-release pin up to its release', async () => {
    const { pr, opened } = fakePr();
    await cmdUpgrade(
      { repoRoot: pinned('v2.0.0-dev.9') },
      deps(pr, 'v2.0.0', () => TEMPLATE_ROOT),
    );
    expect(opened[0]!.branch).toBe('oak/upgrade-v2.0.0');
  });

  it('--to moves a pin back', async () => {
    const { pr, opened } = fakePr();
    await cmdUpgrade(
      { repoRoot: pinned('v1.0.1-dev.2'), to: 'v1.0.0' },
      deps(pr, 'v9.0.0', () => TEMPLATE_ROOT),
    );
    expect(opened[0]!.branch).toBe('oak/upgrade-v1.0.0');
  });

  it('reports an update of the open pull request', async () => {
    const lines: string[] = [];
    const pr: UpgradePr = {
      open: () => ({ url: 'https://github.com/me/paper/pull/9', action: 'updated' }),
    };
    const out = await cmdUpgrade(
      { repoRoot: makeRepo() },
      { ...deps(pr, 'v2.0.0', () => TEMPLATE_ROOT), log: (m) => lines.push(m) },
    );
    expect(out.result.pr_action).toBe('updated');
    expect(lines.join('\n')).toContain('updated upgrade PR');
  });

  it('reports an open pull request that already has these changes', async () => {
    const lines: string[] = [];
    const pr: UpgradePr = {
      open: () => ({ url: 'https://github.com/me/paper/pull/9', action: 'current' }),
    };
    const out = await cmdUpgrade(
      { repoRoot: makeRepo() },
      { ...deps(pr, 'v2.0.0', () => TEMPLATE_ROOT), log: (m) => lines.push(m) },
    );
    expect(out.result.pr_action).toBe('current');
    expect(lines.join('\n')).toContain('already has these changes');
  });
});

describe('the minimum engine version the workflows declare', () => {
  /** A template whose pins.yml asks for `min`. */
  function templateNeeding(min: string): string {
    const target = tmp('oak-tmpl-');
    cpSync(TEMPLATE_ROOT, target, { recursive: true });
    const pins = join(target, '.github/actions/engine/pins.yml');
    const doc = parseDocument(readFileSync(pins, 'utf8'));
    doc.set(MIN_ENGINE_KEY, min);
    writeFileSync(pins, doc.toString());
    return target;
  }

  it('--files-only refuses to leave the pin below it, and changes nothing', async () => {
    const repo = makeRepo(); // pinned at v1.0.0
    const before = readFileSync(join(repo, '.github/actions/engine/pins.yml'), 'utf8');
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, filesOnly: true },
      deps(pr, 'v2.0.0', () => templateNeeding('v2.0.0')),
    );
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('v2.0.0 or newer');
    expect(String(out.result.message)).toContain('without --files-only');
    expect(opened).toHaveLength(0);
    expect(readFileSync(join(repo, '.github/actions/engine/pins.yml'), 'utf8')).toBe(before);
  });

  it('a run moves the pin with the files, so it passes', async () => {
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: makeRepo() },
      deps(pr, 'v2.0.0', () => templateNeeding('v2.0.0')),
    );
    expect(out.exitCode).toBe(0);
    expect(opened[0]!.paths).toContain('myst.yml');
    expect(opened[0]!.paths).toContain('.github/actions/engine/pins.yml');
  });

  it('refuses a --to below it, and changes nothing', async () => {
    const repo = makeRepo();
    const before = readFileSync(join(repo, 'myst.yml'), 'utf8');
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, to: 'v1.2.0' },
      deps(pr, 'v9.0.0', () => templateNeeding('v1.5.0')),
    );
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('--to');
    expect(opened).toHaveLength(0);
    expect(readFileSync(join(repo, 'myst.yml'), 'utf8')).toBe(before);
  });

  it('a dev release passes a minimum naming an earlier one, and fails a minimum naming its release', async () => {
    const run = async (min: string) =>
      (
        await cmdUpgrade(
          { repoRoot: makeRepo(), to: 'v2.0.0-dev.3' },
          deps(fakePr().pr, 'v9.0.0', () => templateNeeding(min)),
        )
      ).exitCode;
    expect(await run('v2.0.0-dev.1')).toBe(0);
    expect(await run('v2.0.0')).toBe(2);
  });

  it('refuses a minimum that is not a release tag', async () => {
    const out = await cmdUpgrade(
      { repoRoot: makeRepo(), to: 'v2.0.0' },
      deps(fakePr().pr, 'v2.0.0', () => templateNeeding('v2.0.0-0')),
    );
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('min_engine_version');
  });

  it('--files-only refuses to leave a pin that is not a release tag', async () => {
    const repo = makeRepo();
    const myst = join(repo, 'myst.yml');
    const doc = parseDocument(readFileSync(myst, 'utf8'));
    doc.setIn(['project', 'options', 'oaktree-sapling', 'version'], 'main');
    writeFileSync(myst, doc.toString());
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, to: 'v2.0.0', filesOnly: true },
      deps(pr, 'v2.0.0', () => templateNeeding('v2.0.0')),
    );
    expect(out.exitCode).toBe(2);
    expect(String(out.result.message)).toContain('without --files-only');
    expect(opened).toHaveLength(0);
  });
});
