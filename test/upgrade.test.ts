/**
 * `oak upgrade`, with fakes for gh and git: computeDrift resets to the template (no change, a
 * changed template, a file edited in the repo); --version-only writes only myst.yml;
 * --files-only overwrites only the engine-managed files that differ; --both; an up-to-date repo
 * gets no pull request; and the pull request's branch and paths.
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
    appendFileSync(join(target, '.github/workflows/ci.yml'), '\n# new template line\n');
    expect(computeDrift(repo, target, readAnswers(repo))).toEqual(['.github/workflows/ci.yml']);
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
    appendFileSync(join(repo, '.github/workflows/ci.yml'), '\n# hand edit\n');
    const { pr } = fakePr();
    await cmdUpgrade(
      { repoRoot: repo, mode: 'files-only' },
      deps(pr, 'v2.0.0', () => TEMPLATE_ROOT),
    );
    expect(readFileSync(co, 'utf8')).toContain('@org/editors @alice');
  });

  it('reports a file edited in the repo, to reset to the template', () => {
    const repo = makeRepo();
    appendFileSync(join(repo, '.github/workflows/publish.yml'), '\n# hand edit\n');
    expect(computeDrift(repo, TEMPLATE_ROOT, readAnswers(repo))).toEqual([
      '.github/workflows/publish.yml',
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
      return 'https://github.com/me/paper/pull/9';
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
      { repoRoot: repo, mode: 'both' },
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
      { repoRoot: repo, mode: 'files-only' },
      deps(pr, 'v2.0.0', () => TEMPLATE_ROOT),
    ).then(() => {
      expect(existsSync(join(repo, '.github/workflows/retired.yml'))).toBe(true);
    });
  });
});

describe('cmdUpgrade', () => {
  it('--version-only writes only myst.yml, and the pull request has only that path', async () => {
    const repo = makeRepo();
    const before = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8');
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, mode: 'version-only' },
      deps(pr, 'v2.0.0', () => TEMPLATE_ROOT),
    );
    expect(out.result.version_bumped).toBe(true);
    const myst = parseDocument(readFileSync(join(repo, 'myst.yml'), 'utf8'));
    expect(myst.getIn(['project', 'options', 'oaktree-sapling', 'version'])).toBe('v2.0.0');
    expect(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8')).toBe(before); // workflows unchanged
    expect(opened[0]!.paths).toEqual(['myst.yml']);
    expect(opened[0]!.branch).toBe('oak/upgrade-v2.0.0');
  });

  it('--files-only overwrites only the engine-managed files that differ, not myst.yml', async () => {
    const repo = makeRepo();
    const mystBefore = readFileSync(join(repo, 'myst.yml'), 'utf8');
    const target = tmp('oak-tmpl-');
    cpSync(TEMPLATE_ROOT, target, { recursive: true });
    appendFileSync(join(target, '.github/workflows/ci.yml'), '\n# upgraded\n');

    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, mode: 'files-only' },
      deps(pr, 'v2.0.0', () => target),
    );
    expect(out.result.version_bumped).toBe(false);
    expect(out.result.drift).toEqual(['.github/workflows/ci.yml']);
    expect(readFileSync(join(repo, 'myst.yml'), 'utf8')).toBe(mystBefore); // version not changed
    expect(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8')).toContain('# upgraded'); // resynced
    expect(opened[0]!.paths).toEqual(['.github/workflows/ci.yml']);
    expect(opened[0]!.paths.every((p) => p.startsWith('.github/') || p === 'CODEOWNERS')).toBe(
      true,
    );
  });

  it('--both sets the version and resets the files that differ', async () => {
    const repo = makeRepo();
    const target = tmp('oak-tmpl-');
    cpSync(TEMPLATE_ROOT, target, { recursive: true });
    appendFileSync(join(target, '.github/workflows/ci.yml'), '\n# upgraded\n');

    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, mode: 'both' },
      deps(pr, 'v3.0.0', () => target),
    );
    expect(out.result.version_bumped).toBe(true);
    expect(out.result.drift).toEqual(['.github/workflows/ci.yml']);
    expect(opened[0]!.paths).toContain('myst.yml');
    expect(opened[0]!.paths).toContain('.github/workflows/ci.yml');
  });

  it('a repo already at the target gets no pull request', async () => {
    const repo = makeRepo(); // version v1.0.0, workflows match the template
    const { pr, opened } = fakePr();
    const out = await cmdUpgrade(
      { repoRoot: repo, mode: 'both' },
      deps(pr, 'v1.0.0', () => TEMPLATE_ROOT),
    );
    expect(out.result.up_to_date).toBe(true);
    expect(out.result.pr).toBeNull();
    expect(opened).toHaveLength(0);
  });
});
