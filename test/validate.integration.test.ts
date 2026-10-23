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
import { basename, join } from 'node:path';
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

    /** The fixture paper with no abstract and a made-up CRediT role. */
    function failingPaper(): string {
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
      return tmp;
    }

    it('fails a made-up CRediT role and a missing abstract: exit 1', () => {
      const { exitCode, out } = runValidate(failingPaper());
      expect(exitCode).toBe(1);
      expect(out.checkRun.conclusion).toBe('failure');
      const credit = out.checks.filter((c: any) => c.id === 'authors-have-credit-roles');
      expect(
        credit.some((c: any) => c.status === 'fail' && /invalid CRediT role/i.test(c.message)),
      ).toBe(true);
      const abstract = out.checks.find((c: any) => c.id === 'abstract-exists');
      expect(abstract.status).toBe('fail');
    }, 60_000);

    it('--report writes the full JSON, with checkRun, for post-checks', () => {
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

    it('--report exits 0 on a failing result, since post-checks posts it', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'oak-report-'));
      const reportPath = join(tmp, 'report.json');
      const r = spawnSync(
        'node',
        [bundle, 'validate', '--paper', failingPaper(), '--instance', fixtureInstance].concat([
          '--repo',
          repo,
          '--report',
          reportPath,
        ]),
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      expect(JSON.parse(readFileSync(reportPath, 'utf8')).checkRun.conclusion).toBe('failure');
    }, 60_000);

    it('--report exits nonzero only when no report was written', () => {
      const reportPath = join(tmpdir(), 'oak-no-such-dir', 'nested', 'report.json');
      const r = spawnSync(
        'node',
        [bundle, 'validate', '--paper', fixturePaper, '--instance', fixtureInstance].concat([
          '--repo',
          repo,
          '--report',
          reportPath,
        ]),
        { encoding: 'utf8' },
      );
      expect(r.status).not.toBe(0);
      expect(existsSync(reportPath)).toBe(false);
    }, 60_000);

    it('on a pull_request run, leaves pr-number and paper beside the report', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'oak-report-'));
      const eventPath = join(tmp, 'event.json');
      writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 42 } }));
      const r = spawnSync(
        'node',
        [bundle, 'validate', '--paper', fixturePaper, '--instance', fixtureInstance].concat([
          '--repo',
          repo,
          '--report',
          join(tmp, 'report.json'),
        ]),
        {
          encoding: 'utf8',
          cwd: fixturePaper,
          env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath },
        },
      );
      expect(r.status).toBe(0);
      expect(readFileSync(join(tmp, 'pr-number'), 'utf8')).toBe('42\n');
      expect(readFileSync(join(tmp, 'paper'), 'utf8')).toBe('.\n');
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
      // A missing file would tell the author only "engine crash".
      const dir = paperOnly();
      const report = join(dir, 'report.json');
      const r = spawnSync('node', [bundle, 'validate', '--paper', dir, '--report', report], {
        encoding: 'utf8',
      });
      // A report was written, so the run passes and post-checks posts the failure.
      expect(r.status).toBe(0);
      expect(existsSync(report)).toBe(true);
      const written = JSON.parse(readFileSync(report, 'utf8'));
      expect(written.checkRun.conclusion).toBe('failure');
      // The report carries the reason, since post-checks posts it on the pull request.
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

/* --------------------------------------------------------------------------
 * The journal's check files [R208], through the bundle: the two worked examples from
 * `test/journal-checks/`, listed beside the catalog checks in a copy of the fixture journal.
 * ------------------------------------------------------------------------ */
describe.skipIf(bundleState() === 'absent')("oak validate, the journal's check files", () => {
  beforeAll(assertBundleNotStale);

  const checkFiles = ['./checks/pseudo-headings.mjs', './checks/duplicate-abstract.mjs'];

  /** A copy of the fixture journal that also lists the two check files. */
  function journalWithCheckFiles(optional: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'oak-val-checkfiles-'));
    cpSync(fixtureInstance, dir, { recursive: true });
    mkdirSync(join(dir, 'checks'));
    for (const id of checkFiles) {
      copyFileSync(join(engineDir, 'test', 'journal-checks', basename(id)), join(dir, id));
    }
    const entries = checkFiles
      .map((id) => `  - id: ${id}\n${optional ? '    optional: true\n' : ''}`)
      .join('');
    const journalYml = readFileSync(join(dir, 'journal.yml'), 'utf8').replace(
      '  - id: keywords-defined\n',
      `  - id: keywords-defined\n${entries}`,
    );
    writeFileSync(join(dir, 'journal.yml'), journalYml);
    return dir;
  }

  function validateWith(paper: string, journal: string): { exitCode: number; out: any } {
    const r = spawnSync(
      'node',
      [bundle, 'validate', '--paper', paper, '--instance', journal, '--repo', repo, '--json'],
      { encoding: 'utf8' },
    );
    return { exitCode: r.status ?? 1, out: JSON.parse(r.stdout) };
  }

  /** The fixture paper with a bold line used as a heading and an Abstract section, which
   *  duplicates the abstract its myst.yml and part block already set. */
  const failingIndex =
    readFileSync(join(fixturePaper, 'index.md'), 'utf8') +
    '\n## Abstract\n\nThe abstract again.\n\n**Methods**\n\nWhat was done.\n';
  function failingPaper(): string {
    const dir = mkdtempSync(join(tmpdir(), 'oak-val-checkfiles-paper-'));
    for (const f of ['bib.bib', 'myst.yml']) copyFileSync(join(fixturePaper, f), join(dir, f));
    writeFileSync(join(dir, 'index.md'), failingIndex);
    return dir;
  }
  const lineOf = (text: string): number => failingIndex.split('\n').indexOf(text) + 1;

  it('the fixture paper passes both', () => {
    const { exitCode, out } = validateWith(fixturePaper, journalWithCheckFiles(false));
    expect(exitCode).toBe(0);
    expect(out.checkRun.conclusion).toBe('success');
    for (const id of checkFiles) {
      expect(out.checks.filter((c: any) => c.id === id)).toMatchObject([{ status: 'pass' }]);
    }
  }, 60_000);

  it('a bold line and an Abstract section fail both, annotated on their lines', () => {
    const { exitCode, out } = validateWith(failingPaper(), journalWithCheckFiles(false));
    expect(exitCode).toBe(1);
    expect(out.checkRun.conclusion).toBe('failure');
    const rows = out.checks.filter((c: any) => checkFiles.includes(c.id));
    expect(rows).toMatchObject([
      { id: checkFiles[0], status: 'fail', message: '"Methods" is styled as a heading' },
      { id: checkFiles[1], status: 'fail' },
    ]);
    expect(
      out.checkRun.annotations.map((a: any) => [a.path, a.start_line, a.annotation_level]),
    ).toEqual(
      expect.arrayContaining([
        ['index.md', lineOf('**Methods**'), 'failure'],
        ['index.md', lineOf('## Abstract'), 'failure'],
      ]),
    );
  }, 60_000);

  it('marked optional, the same paper passes with both as warnings', () => {
    const { exitCode, out } = validateWith(failingPaper(), journalWithCheckFiles(true));
    expect(exitCode).toBe(0);
    expect(out.checkRun.conclusion).toBe('success');
    const rows = out.checks.filter((c: any) => checkFiles.includes(c.id));
    expect(rows).toMatchObject([
      { status: 'fail', optional: true },
      { status: 'fail', optional: true },
    ]);
    expect(out.checkRun.summary).toContain(`| ${checkFiles[0]} | fail (optional) |`);
  }, 60_000);
});
