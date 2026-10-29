/**
 * What the CLI prints, through the real bundle: what a person sees by default, what `--json`
 * gives, and what an unknown command gets. The plan wording is tested where the plans are built,
 * in bootstrap.test.ts. Skipped without `dist/cli.cjs` (bundle-state.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  cpSync,
  existsSync,
  rmSync,
  utimesSync,
} from 'node:fs';
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

    it('explains the journal repo and --co-located in plain words', () => {
      const { stderr } = oak([]);
      expect(stderr).toMatch(/a public repo holding the journal's settings/);
      expect(stderr).toMatch(/--co-located\s+not ready: one repo for the journal and its papers/);
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

  /** A paper whose pins.yml names `instanceRepo`, and an env that makes git fetch
   *  `https://github.com/<owner>/<name>.git` from `<mirrors>/<owner>/<name>.git`, so the clone
   *  runs offline. The fixture journal is committed at `me/journal`. */
  function pinnedPaper(instanceRepo: string): {
    dir: string;
    mirrors: string;
    env: Record<string, string>;
  } {
    const dir = paperOnly();
    mkdirSync(join(dir, '.github', 'actions', 'engine'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'actions', 'engine', 'pins.yml'),
      `engine_repo: Open-Scholar-Nexus/oaktree-sapling\ninstance_repo: ${instanceRepo}\n`,
    );
    const mirrors = mkdtempSync(join(tmpdir(), 'oak-mirrors-'));
    const journal = join(mirrors, 'me', 'journal.git');
    cpSync(fixtureInstance, journal, { recursive: true });
    const git = (...args: string[]) => spawnSync('git', ['-C', journal, ...args]);
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'journal');
    return {
      dir,
      mirrors,
      env: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.file://${mirrors}/.insteadOf`,
        GIT_CONFIG_VALUE_0: 'https://github.com/',
      },
    };
  }

  it('with no --instance, clones the journal pins.yml names into _build/journal', () => {
    const { dir, env } = pinnedPaper('me/journal');
    const { code, stderr } = oak(['validate', '--paper', dir, '--repo', fixtureRepo], env);
    expect(stderr).toContain('using the journal settings from me/journal');
    expect(stderr).toMatch(/oak validate: PASS/);
    expect(code).toBe(0);
    expect(existsSync(join(dir, '_build', 'journal', 'me', 'journal', 'journal.yml'))).toBe(true);
  }, 60_000);

  it('reuses a cached journal, fetches it again after a week, and falls back to it offline', () => {
    const { dir, mirrors, env } = pinnedPaper('me/journal');
    const args = ['validate', '--paper', dir, '--repo', fixtureRepo];
    oak(args, env);

    const reused = oak(args, env);
    expect(reused.stderr).toMatch(
      /reusing the journal settings from me\/journal fetched (less than a minute|\d+ min) ago/,
    );
    expect(reused.code).toBe(0);

    const stamp = join(dir, '_build', 'journal', 'me', 'journal', '.git', 'oak-fetched');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stamp, eightDaysAgo, eightDaysAgo);
    const updated = oak(args, env);
    expect(updated.stderr).toContain('updated just now');
    expect(updated.code).toBe(0);

    utimesSync(stamp, eightDaysAgo, eightDaysAgo);
    rmSync(mirrors, { recursive: true, force: true });
    const stale = oak(args, env);
    expect(stale.stderr).toMatch(
      /warning: .*could not update the journal settings from me\/journal/,
    );
    expect(stale.stderr).toContain('using the copy fetched 8 days ago');
    expect(stale.code).toBe(0);
  }, 120_000);

  it('a journal that cannot be cloned names the repo and both flags', () => {
    const { dir, env } = pinnedPaper('me/missing');
    const { code, stderr } = oak(['validate', '--paper', dir], env);
    expect(code).toBe(2);
    expect(stderr).toContain('could not clone the journal me/missing');
    expect(stderr).toContain('--instance <path');
    expect(stderr).toContain('--no-instance');
  }, 60_000);

  it('instance_repo: "." with no journal.yml beside the paper is refused', () => {
    const { dir } = pinnedPaper('"."');
    const { code, stderr } = oak(['validate', '--paper', dir]);
    expect(code).toBe(2);
    expect(stderr).toContain('no journal repo found');
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
      '--engine-version',
      'v1.2.3',
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
      [
        'bootstrap',
        'paper',
        '--repo',
        'me/p',
        '--instance',
        'me/i',
        '--edition',
        'e',
        '--engine-version',
        'v1.2.3',
      ],
      { ghStub },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('no account is logged in');
    expect(stderr).toContain('gh auth login');
    expect(stderr).not.toContain('no stable release');
  });

  it('a typed secret flag on bootstrap journal is refused, before any gh call', () => {
    const { code, stderr } = oakOffline([
      'bootstrap',
      'journal',
      '--repo',
      'me/j',
      '--zenodo-token',
      't',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('--zenodo-token');
    expect(stderr).toContain('oak bootstrap paper');
    // This refusal needs no network, so it comes before the gh check.
    expect(stderr).not.toContain('not on PATH');
  });

  it('a malformed --engine-version is refused, before any gh call', () => {
    const { code, stderr } = oakOffline([
      'bootstrap',
      'paper',
      '--repo',
      'me/p',
      '--engine-version',
      'main',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('--engine-version must be a release tag');
    expect(stderr).not.toContain('not on PATH');
  });

  // A release cut exports OAK_VERSION for its own test run, so its bundle may be stable.
  it.skipIf(process.env.OAK_VERSION)(
    'a bundle built outside a release refuses to pick a version, before any gh call',
    () => {
      const version = oak(['--version']).stdout.trim().replace(/^oak /, '');
      expect(version).toMatch(/^\d+\.\d+\.\d+-unreleased\+[0-9a-z]+$/);
      const { code, stderr } = oakOffline(['bootstrap', 'journal', '--repo', 'me/j']);
      expect(code).toBe(2);
      expect(stderr).toContain(`the running oak (${version}) is not a stable release`);
      expect(stderr).toContain('--engine-version <tag>');
      expect(stderr).not.toContain('not on PATH');
    },
  );

  it('an env-derived token does not trigger the refusal', () => {
    const { code, stderr } = oakOffline(
      ['bootstrap', 'journal', '--repo', 'me/j', '--engine-version', 'v1.2.3'],
      { env: { ZENODO_TOKEN: 'zt' } },
    );
    expect(code).toBe(2);
    // It stopped at the gh check, not at a secrets refusal.
    expect(stderr).toContain('not on PATH');
    expect(stderr).not.toContain('--zenodo-token');
  });
});

describe.skipIf(bundleState() === 'absent')("an install missing oak's typst template", () => {
  beforeAll(assertBundleNotStale);

  it('stops the build and names the directory', () => {
    // engineRoot() finds the install by its paper-base.yml; this one has no templates/.
    const install = mkdtempSync(join(tmpdir(), 'oak-notypst-'));
    mkdirSync(join(install, 'dist'));
    copyFileSync(bundlePath, join(install, 'dist', 'cli.cjs'));
    copyFileSync(join(engineDir, 'paper-base.yml'), join(install, 'paper-base.yml'));
    const env = { ...process.env };
    delete env.CI;
    delete env.GITHUB_ACTIONS;
    const r = spawnSync(
      'node',
      [join(install, 'dist', 'cli.cjs'), 'build', '--paper', fixturePaper, '--no-instance'],
      { encoding: 'utf8', env },
    );
    rmSync(install, { recursive: true, force: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      `oak's typst template is missing (${join(install, 'templates', 'typst')})`,
    );
    expect(r.stderr).not.toContain('unexpected error');
  }, 60_000);
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

  it('accepts an empty value where empty means something', () => {
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

describe('--repo takes owner/name', () => {
  it('refuses a value gh would read as an option or a foreign URL', () => {
    for (const bad of ['-u', 'https://evil.example/x/y', 'notarepo']) {
      const r = oak(['upgrade', '--repo', bad, '--yes']);
      expect(r.code, bad).toBe(2);
      expect(r.stderr, bad).toContain('--repo takes a GitHub repo as owner/name');
    }
  });
});

describe('post-checks refuses a forged report [R137]', () => {
  const post = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-report-'));
    const f = join(dir, 'report.json');
    writeFileSync(f, body);
    return oak([
      'post-checks',
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
    // post-checks checks again.
    for (const body of ['{}', '{"checkRun":{}}', '{"checkRun":{"conclusion":3}}', 'null']) {
      const r = post(body);
      expect(r.code, body).toBe(1);
      expect(r.stderr, body).toContain('is not a checks report');
    }
  });

  it('refuses to run without --base and --verified-head from the event', () => {
    const r = oak(['post-checks', '--report', 'r.json', '--repo', 'o/r', '--sha', 'deadbeef']);
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

  /** post-checks on a valid report, with `files` beside it, and no gh on PATH: a refusal has to
   *  come before any GitHub call. */
  function postChecksWith(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'oak-checks-'));
    const report = {
      checkRun: { conclusion: 'success', title: 't', summary: 's', annotations: [] },
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return oak(
      ['post-checks', '--report', join(dir, 'report.json'), '--repo', 'o/r'].concat([
        '--sha',
        'a'.repeat(40),
        '--base',
        'main',
        '--verified-head',
        'a'.repeat(40),
      ]),
      { PATH: dirname(process.execPath) },
    );
  }

  it('post-checks reads pr-number beside the report and refuses a forged one', () => {
    const r = postChecksWith({ 'pr-number': '1/comments?x=' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not a pull request number');
  });

  it('post-checks refuses a paper folder outside the repo', () => {
    const r = postChecksWith({ 'pr-number': '7', paper: '../../elsewhere' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not a folder below the repo root');
  });
});

describe('a sandbox deposit never uses the production token [R102]', () => {
  it('refuses when only the production token is set', () => {
    const env = { ZENODO_TOKEN: 'production-secret', ZENODO_TOKEN_SANDBOX: undefined };
    const r = oak(['deposit', 'prepare', '--sandbox', '--paper', fixturePaper], env);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('ZENODO_TOKEN_SANDBOX');
    expect(r.stderr).toContain('never falls back to the production token');
    expect(r.stdout + r.stderr).not.toContain('production-secret');
  });
});

describe.skipIf(bundleState() === 'absent')('the paper commands hand off to the pinned oak', () => {
  beforeAll(assertBundleNotStale);

  it('checks the pin before any git call, for build, validate and start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-pinned-'));
    writeFileSync(
      join(dir, 'myst.yml'),
      'version: 1\nproject:\n  options:\n    oaktree-sapling:\n      version: v9.9.9\n      edition: e\n',
    );
    mkdirSync(join(dir, '.github', 'actions', 'engine'), { recursive: true });
    writeFileSync(join(dir, '.github', 'actions', 'engine', 'pins.yml'), 'engine_repo: ../..\n');
    const cache = mkdtempSync(join(tmpdir(), 'oak-pinned-cache-'));
    for (const verb of ['build', 'validate', 'start']) {
      const { code, stderr } = oak([verb, '--paper', dir], {
        OAK_USE_RUNNING: undefined,
        XDG_CACHE_HOME: cache,
      });
      expect(code, verb).toBe(2);
      expect(stderr, verb).toContain(`oak ${verb}: engine_repo in`);
    }
    expect(existsSync(join(cache, 'oak'))).toBe(false);
  });
});

describe.skipIf(bundleState() === 'absent')('oak bootstrap hands off to --engine-version', () => {
  beforeAll(assertBundleNotStale);

  it('checks --engine-repo before any git or gh call', () => {
    const cache = mkdtempSync(join(tmpdir(), 'oak-pinned-cache-'));
    const { code, stderr } = oak(
      [
        'bootstrap',
        'journal',
        '--repo',
        'me/j',
        '--engine-version',
        'v9.9.9',
        '--engine-repo',
        '../..',
      ],
      { OAK_USE_RUNNING: undefined, XDG_CACHE_HOME: cache },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('oak bootstrap: --engine-repo must be owner/name');
    expect(stderr).not.toContain('not on PATH');
    expect(existsSync(join(cache, 'oak'))).toBe(false);
  });
});

describe.skipIf(bundleState() === 'absent')('fetching from a non-default engine_repo', () => {
  beforeAll(assertBundleNotStale);

  /** A paper pinning `someone/fork` v9.9.9, served from a local mirror whose `dist/cli.cjs`
   *  records how it was run. */
  function forkPaper() {
    const dir = mkdtempSync(join(tmpdir(), 'oak-pinned-fork-'));
    writeFileSync(
      join(dir, 'myst.yml'),
      'version: 1\nproject:\n  options:\n    oaktree-sapling:\n      version: v9.9.9\n      edition: e\n',
    );
    mkdirSync(join(dir, '.github', 'actions', 'engine'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'actions', 'engine', 'pins.yml'),
      'engine_repo: someone/fork\n',
    );
    const mirrors = mkdtempSync(join(tmpdir(), 'oak-mirrors-'));
    const fork = join(mirrors, 'someone', 'fork.git');
    mkdirSync(join(fork, 'dist'), { recursive: true });
    writeFileSync(
      join(fork, 'dist', 'cli.cjs'),
      "require('fs').writeFileSync(process.env.RAN, JSON.stringify({ argv: process.argv.slice(2), " +
        'env: process.env.OAK_USE_RUNNING })); process.exit(5);\n',
    );
    const git = (...args: string[]) => spawnSync('git', ['-C', fork, ...args]);
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fork');
    git('tag', 'v9.9.9');
    const ran = join(mirrors, 'ran.json');
    const env = {
      OAK_USE_RUNNING: undefined,
      XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'oak-pinned-cache-')),
      RAN: ran,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${mirrors}/.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://github.com/',
    };
    return { dir, env, ran };
  }

  it('refuses without a TTY or --yes, and fetches nothing', () => {
    const { dir, env, ran } = forkPaper();
    const { code, stderr } = oak(['build', '--paper', dir], env);
    expect(code).toBe(2);
    expect(stderr).toContain('from someone/fork (engine_repo in pins.yml)');
    expect(stderr).toContain('Re-run with --yes');
    expect(existsSync(join(env.XDG_CACHE_HOME, 'oak'))).toBe(false);
    expect(existsSync(ran)).toBe(false);
  });

  it('with --yes, clones the tag and runs its oak with the same arguments', () => {
    const { dir, env, ran } = forkPaper();
    const { code, stderr } = oak(['build', '--paper', dir, '--yes'], env);
    expect(code).toBe(5);
    expect(stderr).toContain('oak build: downloading oak v9.9.9 from someone/fork');
    expect(stderr).toContain('oak build: running oak v9.9.9 from someone/fork');
    expect(JSON.parse(readFileSync(ran, 'utf8'))).toEqual({
      argv: ['build', '--paper', dir, '--yes'],
      env: '1',
    });
    expect(existsSync(join(env.XDG_CACHE_HOME, 'oak', 'someone', 'fork', 'v9.9.9'))).toBe(true);
  });
});

describe.skipIf(bundleState() === 'absent')('validate with a malformed --repo', () => {
  beforeAll(assertBundleNotStale);

  it('still writes the report post-checks reads', () => {
    const report = join(mkdtempSync(join(tmpdir(), 'oak-report-')), 'report.json');
    const r = oak([
      'validate',
      '--paper',
      fixturePaper,
      '--instance',
      fixtureInstance,
      '--repo',
      '../..',
      '--report',
      report,
    ]);
    // 0 once the report is written, as for any failing result (writeFailureReport).
    expect(r.code).toBe(0);
    expect(readFileSync(report, 'utf8')).toContain('--repo takes a GitHub repo as owner/name');
  });
});

describe.skipIf(bundleState() === 'absent')('deposit finds the journal as build does', () => {
  beforeAll(assertBundleNotStale);

  it('stops before Zenodo when no journal repo is found', () => {
    const paper = mkdtempSync(join(tmpdir(), 'oak-deposit-'));
    writeFileSync(join(paper, 'myst.yml'), 'version: 1\nproject:\n  title: x\n');
    const r = oak(['deposit', 'status', '--sandbox', '--token', 'x', '--paper', paper]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('oak deposit: no journal repo found');
    expect(r.stderr).toContain("a deposit without the journal's Zenodo settings");
  });
});

describe.skipIf(bundleState() === 'absent')("pins.yml's journal comes before a journal.yml", () => {
  beforeAll(assertBundleNotStale);

  it('beside the paper, which an author can add without an editor', () => {
    const paper = mkdtempSync(join(tmpdir(), 'oak-pinned-journal-'));
    writeFileSync(join(paper, 'myst.yml'), 'version: 1\nproject:\n  title: x\n');
    writeFileSync(join(paper, 'journal.yml'), 'name: Not the journal\n');
    mkdirSync(join(paper, '.github', 'actions', 'engine'), { recursive: true });
    writeFileSync(
      join(paper, '.github', 'actions', 'engine', 'pins.yml'),
      'instance_repo: acme/journal\n',
    );
    // github.com points at an empty folder, so the pinned journal's clone fails offline.
    const r = oak(['deposit', 'status', '--sandbox', '--token', 'x', '--paper', paper], {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${mkdtempSync(join(tmpdir(), 'oak-mirrors-'))}/.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://github.com/',
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('could not clone the journal acme/journal');
  });
});

describe.skipIf(bundleState() === 'absent')('oak release reads the DOI before any token', () => {
  beforeAll(assertBundleNotStale);

  it('refuses a DOI that is not a Zenodo one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-release-doi-'));
    writeFileSync(
      join(dir, 'myst.yml'),
      'version: 1\nproject:\n  doi: https://doi.org/10.5072/zenodo.5\n' +
        '  options:\n    oaktree-sapling:\n      version: v9.9.9\n      edition: e\n',
    );
    const { code, stderr } = oak(
      ['release', '--tag', 'v1.0.0', '--no-build', '--paper', dir, '--no-instance'],
      { OAK_USE_RUNNING: '1', ZENODO_TOKEN: undefined, ZENODO_TOKEN_SANDBOX: undefined },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('oak release: project.doi https://doi.org/10.5072/zenodo.5 is not');
  });

  it('opens a zenodo-publish-failed issue when the deposit fails', () => {
    // No `project.github`, so `cmdPublish` fails before any Zenodo call.
    const dir = mkdtempSync(join(tmpdir(), 'oak-release-issue-'));
    writeFileSync(
      join(dir, 'myst.yml'),
      'version: 1\nproject:\n  doi: 10.5072/zenodo.5\n' +
        '  options:\n    oaktree-sapling:\n      version: v9.9.9\n      edition: e\n',
    );
    mkdirSync(join(dir, '_build', 'exports'), { recursive: true });
    writeFileSync(join(dir, '_build', 'exports', 'paper.pdf'), '%PDF-1.4\n');
    const bin = mkdtempSync(join(tmpdir(), 'oak-gh-stub-'));
    const ghLog = join(bin, 'gh.log');
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${ghLog}"\n`, {
      mode: 0o755,
    });
    const env = {
      ...process.env,
      PATH: `${bin}:${dirname(process.execPath)}`,
      GH_TOKEN: 'x',
      ZENODO_TOKEN_SANDBOX: 'sandbox-token',
      OAK_USE_RUNNING: '1',
    };
    delete env.CI;
    delete env.GITHUB_ACTIONS;
    const r = spawnSync(
      process.execPath,
      [bundlePath, 'release', '--tag', 'v1.0.0', '--no-build', '--paper', dir, '--no-instance'],
      { encoding: 'utf8', env },
    );
    expect(r.status).toBe(2);
    const args = readFileSync(ghLog, 'utf8').split('\n');
    expect(args.slice(0, 2)).toEqual(['issue', 'create']);
    expect(args[args.indexOf('--title') + 1]).toBe('Zenodo publish failed for v1.0.0');
    expect(args[args.indexOf('--body') + 1]).toContain('project.github missing');
    expect(args[args.indexOf('--label') + 1]).toBe('zenodo-publish-failed');
  });
});
