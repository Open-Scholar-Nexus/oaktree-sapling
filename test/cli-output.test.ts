/**
 * What the CLI prints, through the real bundle: what a person sees by default, what `--json`
 * gives, and what an unknown command gets. The plan wording is tested where the plans are built,
 * in bootstrap.test.ts. Skipped without `dist/cli.cjs` (bundle-state.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleState, assertBundleNotStale, bundlePath } from './bundle-state.js';
import { labelChildOutput } from '../src/gh.js';

const engineDir = fileURLToPath(new URL('..', import.meta.url));
/** A copy of the fixture paper, as in `validate.integration.test.ts`: `materializeDerived`
 *  leaves `myst.oak.yml` in the paper root, and the two files run in parallel. */
const fixturePaper = mkdtempSync(join(tmpdir(), 'oak-fixture-paper-'));
cpSync(join(engineDir, 'test', 'fixture-paper'), fixturePaper, {
  recursive: true,
  filter: (src) => !src.endsWith('myst.oak.yml'),
});
const fixtureInstance = join(engineDir, 'test', 'fixture-instance');
/** The repo the fixture paper is registered to; the id uniqueness check passes only with it. */
const fixtureRepo = 'open-scholar-nexus/fixture-sample-paper';

/**
 * Runs the bundle as a terminal sees it. `CI` and `GITHUB_ACTIONS` are cleared, since they turn
 * the output into GitHub annotations; kept, these tests would pass locally and fail in CI.
 */
function oak(
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, ...extraEnv };
  // undefined unsets a variable; an empty string would not reach the `??` fallback.
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k];
  delete env.CI;
  delete env.GITHUB_ACTIONS;
  const r = spawnSync('node', [bundlePath, ...args], { encoding: 'utf8', env });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe.skipIf(bundleState() === 'absent')(
  'an unrecognized command is an ERROR, not a manual',
  () => {
    beforeAll(assertBundleNotStale);

    it('names the word it did not understand and suggests the near miss', () => {
      // A typo gets an error, so it does not look like a bare `oak` that did nothing.
      const { code, stderr } = oak(['bootstrp']);
      expect(code).toBe(2);
      expect(stderr).toContain("oak: unknown command 'bootstrp'");
      expect(stderr).toContain("did you mean 'bootstrap'");
    });

    it('says nothing about near misses when nothing is near', () => {
      const { code, stderr } = oak(['zzzzzzzz']);
      expect(code).toBe(2);
      expect(stderr).toContain("oak: unknown command 'zzzzzzzz'");
      expect(stderr).not.toContain('did you mean');
    });

    it('a bare `oak` prints the usage, not an error', () => {
      const { code, stderr } = oak([]);
      expect(code).toBe(2);
      expect(stderr).not.toContain('unknown command');
    });

    it('`--help`, `-h` and `help` print the usage on stdout and succeed', () => {
      for (const arg of ['--help', '-h', 'help']) {
        const { code, stdout, stderr } = oak([arg]);
        expect(code).toBe(0);
        expect(stdout).toMatch(/^oak: a mystmd-based engine/);
        expect(stderr).toBe('');
      }
    });

    it('`--version` prints the version the bundle was built with', () => {
      const { code, stdout } = oak(['--version']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/^oak \d+\.\d+\.\d+\S*\n$/);
    });
  },
);

describe.skipIf(bundleState() === 'absent')(
  'usage opens with what oak is and where to start',
  () => {
    beforeAll(assertBundleNotStale);

    it('leads with a description and the first command a newcomer runs', () => {
      const { stderr } = oak([]);
      const head = stderr.split('\n').slice(0, 8).join('\n');
      expect(head).toMatch(/^oak: a mystmd-based engine for running a small journal/);
      expect(head).toContain('oak bootstrap journal');
      // The command list still follows.
      expect(stderr).toContain('oak validate');
    });

    it('explains --external and --co-located in plain words', () => {
      const { stderr } = oak([]);
      expect(stderr).toMatch(/--external\s+the journal gets its own public repo/);
      expect(stderr).toMatch(
        /--co-located\s+experimental: one repo holds the journal and its single paper/,
      );
    });

    it('documents --json and --verbose', () => {
      const { stderr } = oak([]);
      expect(stderr).toContain('--json');
      expect(stderr).toContain('--verbose');
    });
  },
);

describe.skipIf(bundleState() === 'absent')('--json gates the machine envelope', () => {
  beforeAll(assertBundleNotStale);

  /** The fixture paper, alone in a temp dir (no journal.yml beside it). */
  function paperOnly(): string {
    const dir = mkdtempSync(join(tmpdir(), 'oak-cliout-'));
    for (const f of ['bib.bib', 'index.md', 'myst.yml'])
      copyFileSync(join(fixturePaper, f), join(dir, f));
    return dir;
  }

  it('oak validate: stdout is empty without --json, and the result goes to stderr', () => {
    const { code, stdout, stderr } = oak([
      'validate',
      '--paper',
      fixturePaper,
      '--instance',
      fixtureInstance,
      '--repo',
      fixtureRepo,
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(stderr).toMatch(/oak validate: PASS/);
  }, 60_000);

  it('oak validate prints the same counts as the Check Run it reports', () => {
    const args = ['validate', '--paper', fixturePaper, '--instance', fixtureInstance];
    const { stderr } = oak([...args, '--repo', fixtureRepo]);
    const { stdout } = oak([...args, '--repo', fixtureRepo, '--json']);
    const title = JSON.parse(stdout).checkRun.title as string;
    expect(title).toMatch(/^\d+ passed, \d+ failed/);
    expect(stderr).toContain(`oak validate: PASS (${title})`);
  }, 60_000);

  it('oak validate: --json puts the full JSON, checkRun included, on stdout', () => {
    const { stdout } = oak([
      'validate',
      '--paper',
      fixturePaper,
      '--instance',
      fixtureInstance,
      '--repo',
      fixtureRepo,
      '--json',
    ]);
    const out = JSON.parse(stdout);
    expect(out.status).toBe('ok');
    expect(out.checkRun.conclusion).toBe('success');
  }, 60_000);

  it('the summary lists every finding', () => {
    // Every finding is printed.
    const { stderr } = oak(['validate', '--paper', paperOnly(), '--no-instance']);
    expect(stderr).toMatch(/oak validate: (PASS|FAIL)/);
    // The fixture has no thumbnail, and an uncomposed run adds a note; either way, one warning
    // shows that the JSON's findings reach the screen.
    expect(stderr).toMatch(/[✗!→]/);
  }, 60_000);

  it('a refusal prints the sentence, not a JSON record', () => {
    // `oak upgrade --paper <dir>` on a directory that is not a paper repo: refused locally,
    // without the network, printed as every error is without --json.
    const { code, stdout, stderr } = oak([
      'upgrade',
      '--paper',
      mkdtempSync(join(tmpdir(), 'oak-notapaper-')),
    ]);
    expect(code).toBe(2);
    expect(stdout.trim()).toBe('');
    expect(stderr).not.toContain('"status"');
    expect(stderr).toContain('pins.yml');
  });
});

describe.skipIf(bundleState() === 'absent')('a broken paper gets a sentence, never a stack', () => {
  beforeAll(assertBundleNotStale);

  /** A journal repo: journal.yml, and a myst.yml that is the website (no version key). */
  function journalRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'oak-journal-'));
    writeFileSync(join(dir, 'journal.yml'), 'name: A Journal\nid_pattern: ".*"\n');
    writeFileSync(
      join(dir, 'myst.yml'),
      'version: 1\nproject:\n  title: A Journal\nsite:\n  template: book-theme\n',
    );
    return dir;
  }

  it('oak build in the journal repo says so', () => {
    // `oak build` in a journal repo: its journal.yml must not be taken for a journal beside a
    // paper ({@link isJournalRepo}).
    const dir = journalRepo();
    const { code, stderr } = oak(['build', '--paper', dir]);
    expect(code).toBe(2);
    expect(stderr).toContain('is the journal repo, not a paper');
    expect(stderr).toContain('--paper');
    // No stack, and no GitHub annotation syntax outside CI.
    expect(stderr).not.toContain('::error::');
    expect(stderr).not.toMatch(/\bat \w+ \(/);
    expect(stderr).not.toContain('cli.cjs:');
  });

  it('oak validate in the journal repo refuses the same way', () => {
    const { code, stderr } = oak(['validate', '--paper', journalRepo()]);
    expect(code).toBe(2);
    expect(stderr).toContain('is the journal repo, not a paper');
    expect(stderr).not.toContain('::error::');
  });

  it('oak start in a journal repo with no npm install says to run it first', () => {
    const dir = journalRepo();
    writeFileSync(join(dir, 'package.json'), '{"dependencies":{"js-yaml":"^4.1.0"}}\n');
    const { code, stderr } = oak(['start', '--paper', dir]);
    expect(code).toBe(2);
    expect(stderr).toContain('npm install');
    expect(stderr).not.toContain('::error::');
  }, 60_000);

  it('a paper whose myst.yml lost its engine version names the file and the fix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-nocoord-'));
    for (const f of ['bib.bib', 'index.md', 'myst.yml'])
      copyFileSync(join(fixturePaper, f), join(dir, f));
    const authorPath = join(dir, 'myst.yml');
    writeFileSync(authorPath, readFileSync(authorPath, 'utf8').replace(/\n\s*version: .*/, ''));

    const { code, stderr } = oak(['build', '--paper', dir, '--no-instance']);
    expect(code).toBe(2);
    expect(stderr).toContain(authorPath);
    expect(stderr).toContain('project.options.oaktree-sapling');
    expect(stderr).not.toContain('::error::');
    expect(stderr).not.toContain('cli.cjs:');
  }, 60_000);

  it('usage lists oak start next to oak build', () => {
    const { stderr } = oak([]);
    expect(stderr).toMatch(/oak start/);
    expect(stderr).toContain("mystmd's live preview");
  });
});

describe.skipIf(bundleState() === 'absent')('bootstrap preflight ([R110], [R125], [R127])', () => {
  beforeAll(assertBundleNotStale);

  /** Runs the bundle without gh (node by absolute path, PATH a directory without gh), or with
   *  a gh stub that answers --version but is logged out. */
  function oakOffline(
    args: string[],
    opts: { ghStub?: string; env?: NodeJS.ProcessEnv } = {},
  ): { code: number; stderr: string } {
    if (opts.ghStub) {
      writeFileSync(
        opts.ghStub,
        '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\necho "not logged in" >&2\nexit 1\n',
        { mode: 0o755 },
      );
    }
    const env = {
      ...process.env,
      ...opts.env,
      PATH: opts.ghStub ? dirname(opts.ghStub) : mkdtempSync(join(tmpdir(), 'oak-nopath-')),
    };
    delete env.CI;
    delete env.GITHUB_ACTIONS;
    const r = spawnSync(process.execPath, [bundlePath, ...args], { encoding: 'utf8', env });
    return { code: r.status ?? 1, stderr: r.stderr ?? '' };
  }

  it('no gh on PATH is a sentence naming the fix, not a stack or a "no stable release"', () => {
    const { code, stderr } = oakOffline([
      'bootstrap',
      'paper',
      '--repo',
      'me/p',
      '--instance',
      'me/i',
      '--edition',
      'e',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('gh');
    expect(stderr).toContain('not on PATH');
    expect(stderr).toContain('gh auth login');
    // The gh check comes before the release lookup, which would otherwise report "no stable
    // release" when gh is the problem.
    expect(stderr).not.toContain('no stable release');
    expect(stderr).not.toMatch(/\bat \w+ \(/);
  });

  it('a gh that is installed but logged out says gh auth login', () => {
    const ghStub = join(mkdtempSync(join(tmpdir(), 'oak-fakegh-')), 'gh');
    const { code, stderr } = oakOffline(
      ['bootstrap', 'paper', '--repo', 'me/p', '--instance', 'me/i', '--edition', 'e'],
      { ghStub },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('no account is logged in');
    expect(stderr).toContain('gh auth login');
    expect(stderr).not.toContain('no stable release');
  });

  it('a typed secret flag on bootstrap journal --external is refused, before any gh call', () => {
    const { code, stderr } = oakOffline([
      'bootstrap',
      'journal',
      '--repo',
      'me/j',
      '--external',
      '--zenodo-token',
      't',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('--zenodo-token');
    expect(stderr).toContain('oak bootstrap paper');
    // This refusal needs no network, so it comes before the gh check.
    expect(stderr).not.toContain('not on PATH');
  });

  it('an env-derived token does not trigger the refusal', () => {
    const { code, stderr } = oakOffline(['bootstrap', 'journal', '--repo', 'me/j', '--external'], {
      env: { ZENODO_TOKEN: 'zt' },
    });
    expect(code).toBe(2);
    // It stopped at the gh check, not at a secrets refusal.
    expect(stderr).toContain('not on PATH');
    expect(stderr).not.toContain('--zenodo-token');
  });
});

describe('subprocess output carries its provenance', () => {
  it('labels every line with the tool that produced it', () => {
    const out = labelChildOutput(
      'git',
      "Cloning into '/tmp/oak-seed-x'...\n\nwarning: empty repository\n",
    );
    expect(out.split('\n')).toEqual([
      "  [git] Cloning into '/tmp/oak-seed-x'...",
      '  [git] warning: empty repository',
    ]);
  });

  it('an empty capture prints nothing at all', () => {
    expect(labelChildOutput('gh', '')).toBe('');
    expect(labelChildOutput('gh', undefined)).toBe('');
  });
});

describe('a flag passed without a value is refused', () => {
  it('does not swallow the next flag as the value', () => {
    const r = oak(['notify', 'new-version', '--repo', '--pr', '1']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--repo needs a value');
  });

  it('does not fall back to the environment when the value is missing', () => {
    // Several callers read `flag(...) ?? process.env.X`, so a missing value (an unquoted empty
    // shell variable) would act on the environment's repo.
    const r = oak(['notify', 'new-version', '--pr', '1', '--repo']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--repo needs a value');
  });

  it('still accepts a value that merely looks unusual', () => {
    // One dash is a value, not a flag: only `--` is unambiguous enough to refuse.
    const r = oak(['validate', '--paper', '-weird', '--no-instance']);
    expect(r.stderr).not.toContain('needs a value');
  });

  it('refuses an empty --instance', () => {
    // `--instance "$VAR"` with VAR unset: the flag was passed, so "pass --instance" would not
    // help.
    const r = oak(['validate', '--paper', fixturePaper, '--instance', '']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--instance needs a value');
  });

  it('accepts an empty value where empty means something [R147]', () => {
    // `ci/run.sh` passes `--base-url ""` on every pull request build: empty means served at
    // the root.
    const r = oak(['validate', '--paper', fixturePaper, '--no-instance', '--base-url', '']);
    expect(r.stderr).not.toContain('--base-url needs a value');
  });

  it('refuses a port that is not a number', () => {
    const r = oak(['start', '--paper', fixturePaper, '--port', 'abc']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--port needs a port number, not 'abc'");
  });
});

describe('--repo takes owner/name [R138]', () => {
  it('refuses a value gh would read as an option or a foreign URL', () => {
    for (const bad of ['-u', 'https://evil.example/x/y', 'notarepo']) {
      const r = oak(['upgrade', '--repo', bad, '--yes']);
      expect(r.code, bad).toBe(2);
      expect(r.stderr, bad).toContain('takes owner/name');
    }
  });
});

describe('check-post refuses a forged report [R137]', () => {
  const post = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-report-'));
    const f = join(dir, 'report.json');
    writeFileSync(f, body);
    return oak([
      'check-post',
      '--report',
      f,
      '--repo',
      'o/r',
      '--sha',
      'deadbeef',
      '--base',
      'main',
      '--verified-head',
      'deadbeef',
    ]);
  };

  it('refuses JSON it cannot parse', () => {
    const r = post('{ truncated');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is not a checks report');
  });

  it('refuses valid JSON without a result', () => {
    // The `pull_request` job's `jq -e .checkRun.conclusion` check runs on the fork's code, so
    // check-post checks again.
    for (const body of ['{}', '{"checkRun":{}}', '{"checkRun":{"conclusion":3}}', 'null']) {
      const r = post(body);
      expect(r.code, body).toBe(1);
      expect(r.stderr, body).toContain('is not a checks report');
    }
  });

  it('refuses to run without --base and --verified-head from the event', () => {
    const r = oak(['check-post', '--report', 'r.json', '--repo', 'o/r', '--sha', 'deadbeef']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--verified-head <headsha> are required');
  });
});

describe('a pull request number is a number [R136]', () => {
  it('refuses one that is not, whether it came from a flag or the artifact', () => {
    const r = oak(['notify', 'new-version', '--pr', '1/comments?x=', '--paper', fixturePaper]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not a pull request number');
  });
});

describe('a sandbox deposit never uses the production token [R133]', () => {
  it('refuses when only the production token is set', () => {
    const env = { ZENODO_TOKEN: 'production-secret', ZENODO_TOKEN_SANDBOX: undefined };
    const r = oak(['deposit', 'prepare', '--sandbox', '--paper', fixturePaper], env);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('ZENODO_TOKEN_SANDBOX');
    expect(r.stdout + r.stderr).not.toContain('production-secret');
  });
});
