/**
 * The editorial checks (Layer B, from `@curvenote/check-implementations`) over the fixture paper,
 * through the bundled CLI. Like integration.test.ts, it runs `node dist/cli.cjs`: the checks
 * read myst's processed project, and myst-cli crashes unbundled on Node 24 [R51]. So this runs
 * what CI runs. Skipped without the bundle.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleState, assertBundleNotStale } from './bundle-state.js';

const engineDir = fileURLToPath(new URL('..', import.meta.url));
const bundle = join(engineDir, 'dist', 'cli.cjs');
/**
 * A copy of the fixture paper, not the shared `test/fixture-paper`. `materializeDerived` leaves
 * `myst.oak.yml` in the paper root, and vitest runs test files in parallel; two suites
 * validating one directory would read each other's `myst.oak.yml`.
 */
const fixturePaper = mkdtempSync(join(tmpdir(), 'oak-fixture-paper-'));
cpSync(join(engineDir, 'test', 'fixture-paper'), fixturePaper, {
  recursive: true,
  filter: (src) => !src.endsWith('myst.oak.yml'),
});
const fixtureInstance = join(engineDir, 'test', 'fixture-instance');
const repo = 'open-scholar-nexus/fixture-sample-paper';

/** Runs `oak validate --json`, capturing stdout and stderr separately. */
function spawnValidate(paper: string): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'node',
    [bundle, 'validate', '--paper', paper, '--instance', fixtureInstance, '--repo', repo, '--json'],
    { encoding: 'utf8' },
  );
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Runs and parses the JSON. stdout must be only JSON, since cmdValidate sends myst's progress
 *  to stderr, so a stray write to stdout fails the parse. */
function runValidate(paper: string): { exitCode: number; out: any } {
  const { exitCode, stdout } = spawnValidate(paper);
  return { exitCode, out: JSON.parse(stdout) };
}

describe.skipIf(bundleState() === 'absent')(
  'oak validate, curvenote Layer-B checks (bundled)',
  () => {
    beforeAll(assertBundleNotStale);
    it("passes the fixture paper: the journal's 5 checks pass, exit 0", () => {
      const { exitCode, out } = runValidate(fixturePaper);
      expect(exitCode).toBe(0);
      expect(out.status).toBe('ok');
      expect(out.checkRun.conclusion).toBe('success');
      const ids = new Set(out.checks.map((c: any) => c.id));
      for (const id of [
        'authors-exist',
        'authors-have-orcid',
        'authors-have-credit-roles',
        'abstract-exists',
        'keywords-defined',
      ]) {
        expect(ids.has(id)).toBe(true);
      }
      expect(out.checks.every((c: any) => c.status === 'pass')).toBe(true);
    }, 60_000);

    it("--json stdout is only JSON; myst's progress goes to stderr", () => {
      const { stdout, stderr } = spawnValidate(fixturePaper);
      // stdout parses as it is, with nothing before the JSON.
      expect(stdout.trimStart().startsWith('{')).toBe(true);
      expect(() => JSON.parse(stdout)).not.toThrow();
      // myst's output (a `console.debug` in `new Session()` and the `📖/📚 Built` lines) goes to
      // stderr.
      expect(stdout).not.toMatch(/building myst-cli session|📖 Built|📚 Built/);
      expect(stderr).toMatch(/building myst-cli session with API URL/);
    }, 60_000);

    it('fails a made-up CRediT role and a missing abstract: exit 1', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'oak-val-'));
      copyFileSync(join(fixturePaper, 'bib.bib'), join(tmp, 'bib.bib'));
      // index.md without the abstract part
      writeFileSync(
        join(tmp, 'index.md'),
        '# A Fixture Paper\n\n## Introduction\n\nNo abstract part here.\n',
      );
      // myst.yml with the project-level abstract removed and a bogus CRediT role
      const myst = readFileSync(join(fixturePaper, 'myst.yml'), 'utf8')
        .replace(/ {2}abstract: .*\n/, '')
        .replace('    - conceptualization\n', '    - not-a-real-credit-role\n');
      writeFileSync(join(tmp, 'myst.yml'), myst);

      const { exitCode, out } = runValidate(tmp);
      expect(exitCode).toBe(1);
      expect(out.checkRun.conclusion).toBe('failure');
      const credit = out.checks.filter((c: any) => c.id === 'authors-have-credit-roles');
      expect(
        credit.some((c: any) => c.status === 'fail' && /invalid CRediT role/i.test(c.message)),
      ).toBe(true);
      const abstract = out.checks.find((c: any) => c.id === 'abstract-exists');
      expect(abstract.status).toBe('fail');
    }, 60_000);

    it('--report writes the full JSON, with checkRun, for check-post', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'oak-report-'));
      const reportPath = join(tmp, 'report.json');
      const r = spawnSync(
        'node',
        [
          bundle,
          'validate',
          '--paper',
          fixturePaper,
          '--instance',
          fixtureInstance,
          '--repo',
          repo,
          '--report',
          reportPath,
        ],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      expect(existsSync(reportPath)).toBe(true);
      const written = JSON.parse(readFileSync(reportPath, 'utf8'));
      // The report always holds the full JSON, `checkRun` included, with or without --json.
      expect(written.checkRun.conclusion).toBe('success');
      expect(Array.isArray(written.checks)).toBe(true);
      expect(written.status).toBe('ok');
    }, 60_000);
  },
);

describe.skipIf(bundleState() === 'absent')('the COMPOSED view reaches the checks ([R82])', () => {
  beforeAll(assertBundleNotStale);

  it('the thumbnail check reports a missing thumbnail [R81]', () => {
    // `paper-base.yml` sets `project.thumbnail`, which exists only after `extends`, so only a
    // composed run sees it [R82]. The fixture paper has no `thumbnails/`, so the run says so.
    const { out } = runValidate(fixturePaper);
    const thumb = out.warnings.find((w: any) => w.check === 'thumbnail');
    expect(thumb).toBeDefined();
    expect(thumb.message).toMatch(/thumbnails\/thumbnail\.png/);
    // A warning, not an error: it does not block a paper that is otherwise fine [R81].
    expect(out.status).toBe('ok');
  }, 60_000);

  it('and says nothing once the file is there', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oak-val-thumb-'));
    copyFileSync(join(fixturePaper, 'bib.bib'), join(tmp, 'bib.bib'));
    copyFileSync(join(fixturePaper, 'index.md'), join(tmp, 'index.md'));
    copyFileSync(join(fixturePaper, 'myst.yml'), join(tmp, 'myst.yml'));
    mkdirSync(join(tmp, 'thumbnails'), { recursive: true });
    writeFileSync(join(tmp, 'thumbnails', 'thumbnail.png'), 'not a real png, but a real file');

    const { out } = runValidate(tmp);
    expect(out.warnings.some((w: any) => w.check === 'thumbnail')).toBe(false);
  }, 60_000);

  it('reports no template-override for a paper that declares no template of its own', () => {
    // Compose always sets a template on the composed export, so the author's own value is read
    // from their myst.yml, not from the composed project.
    const { out } = runValidate(fixturePaper);
    expect(out.warnings.some((w: any) => w.check === 'template-override')).toBe(false);
    expect(out.errors.some((e: any) => e.check === 'template-override')).toBe(false);
  }, 60_000);
});

/* --------------------------------------------------------------------------
 * Finding the journal repo [R38], and the report written when validate cannot run. With
 * `instance_repo: .` the engine action passes no `--instance`, so validate looks for a
 * journal.yml beside the paper; when it finds none, it still writes a report.
 * ------------------------------------------------------------------------ */
describe.skipIf(bundleState() === 'absent')(
  'oak validate, instance resolution + crash reporting',
  () => {
    beforeAll(assertBundleNotStale);

    /** A copy of the fixture paper, alone (no journal.yml beside it). */
    function paperOnly(): string {
      const dir = mkdtempSync(join(tmpdir(), 'oak-val-noinst-'));
      for (const f of ['bib.bib', 'index.md', 'myst.yml'])
        copyFileSync(join(fixturePaper, f), join(dir, f));
      return dir;
    }

    it('writes a failing report when no journal repo is found', () => {
      // The `pull_request` job checks `jq -e '.checkRun.conclusion' report.json`; a missing file
      // would tell the author only "engine crash".
      const dir = paperOnly();
      const report = join(dir, 'report.json');
      const r = spawnSync('node', [bundle, 'validate', '--paper', dir, '--report', report], {
        encoding: 'utf8',
      });
      expect(r.status).toBe(2);
      expect(existsSync(report)).toBe(true);
      const written = JSON.parse(readFileSync(report, 'utf8'));
      expect(written.checkRun.conclusion).toBe('failure');
      // The report carries the reason, since check-post posts it on the pull request.
      expect(written.checkRun.summary).toContain('pins.yml');
      expect(String(written.errors[0])).toContain('no journal repo found');
    }, 60_000);

    it('the error names pins.yml and what `instance_repo: .` means', () => {
      const r = spawnSync('node', [bundle, 'validate', '--paper', paperOnly()], {
        encoding: 'utf8',
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('instance_repo');
      expect(r.stderr).toContain('--no-instance');
    }, 60_000);

    it('uses a journal.yml beside the paper as the journal repo [R38]', () => {
      // What `instance_repo: .` means: the journal.yml sits beside the paper.
      const dir = mkdtempSync(join(tmpdir(), 'oak-val-colo-'));
      for (const f of ['bib.bib', 'index.md', 'myst.yml'])
        copyFileSync(join(fixturePaper, f), join(dir, f));
      cpSync(fixtureInstance, dir, { recursive: true });
      const report = join(dir, 'report.json');
      const r = spawnSync(
        'node',
        [bundle, 'validate', '--paper', dir, '--repo', repo, '--report', report, '--json'],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.checkRun.conclusion).toBe('success');
      // Composed with the journal.yml beside the paper: its five checks ran.
      const ids = new Set(out.checks.map((c: any) => c.id));
      expect(ids.has('abstract-exists')).toBe(true);
      // It did not fall back to the author's config alone.
      expect((out.notes ?? []).join(' ')).not.toMatch(/uncomposed/i);
    }, 60_000);

    it('--no-instance still checks the paper on its own', () => {
      const r = spawnSync(
        'node',
        [bundle, 'validate', '--paper', paperOnly(), '--no-instance', '--json'],
        {
          encoding: 'utf8',
        },
      );
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).checkRun.conclusion).toBe('success');
    }, 60_000);
  },
);
