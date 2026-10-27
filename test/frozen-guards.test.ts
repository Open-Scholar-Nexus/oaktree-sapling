/**
 * The checks in the paper template's workflows, run as shell from the real YAML [R99]
 * [R90]. Each test takes a step's `run:` script by id and runs it, so it tests the files that
 * ship.
 *
 * This is bash, not a GitHub runner: there `${{ }}` is resolved before the step runs,
 * `$GITHUB_OUTPUT` is a real file, and the shell differs. So it covers the scripts, plus
 * `secrets` in an `if:`, checked below [R172]; other workflow-level faults pass here, and
 * conformance is what runs them on GitHub.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { readdirSync } from 'node:fs';
import { SECRET_MAP } from '../src/bootstrap.js';
import {
  ENGINE_VERSION,
  PAPER_VERSION_TAG,
  compareEngineVersions,
  isStableEngineVersion,
} from '../src/schema.js';

const SHIM = 'templates/paper';

/** The `run:` script of the step with this `id` (or `name`), from a template workflow or action. */
function stepScript(file: string, id: string | undefined, name?: string): string {
  const doc = parseDocument(readFileSync(join(SHIM, file), 'utf8')).toJS() as {
    runs?: { steps: Array<Record<string, string>> };
    jobs?: Record<string, { steps: Array<Record<string, string>> }>;
  };
  const steps = doc.runs
    ? doc.runs.steps
    : Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
  const step = steps.find((s) => (id ? s.id === id : s.name === name));
  if (!step?.run) throw new Error(`no step '${id ?? name}' with a run: in ${file}`);
  return step.run;
}

function run(script: string, env: Record<string, string>, cwd?: string) {
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, GITHUB_OUTPUT: '/dev/null', ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** Runs the engine action's ref step with `yq` stubbed to print `value` for myst.yml and `min`
 *  for pins.yml, and a real GITHUB_OUTPUT file. */
function refStep(value: string, min = '') {
  const script = stepScript('.github/actions/engine/action.yml', 'ref');
  const dir = mkdtempSync(join(tmpdir(), 'oak-ref-'));
  const bin = mkdtempSync(join(tmpdir(), 'oak-bin-'));
  writeFileSync(join(dir, 'myst.yml'), 'project: {}');
  writeFileSync(
    join(bin, 'yq'),
    `#!/bin/sh\ncase "$2" in *pins.yml) printf '%s' "$YQ_MIN" ;; *) printf '%s' "$YQ_VALUE" ;; esac\n`,
  );
  chmodSync(join(bin, 'yq'), 0o755);
  const outFile = join(dir, 'gh_output');
  writeFileSync(outFile, '');
  const r = run(
    script,
    { PATH: `${bin}:${process.env.PATH}`, YQ_VALUE: value, YQ_MIN: min, GITHUB_OUTPUT: outFile },
    dir,
  );
  return { ...r, output: readFileSync(outFile, 'utf8') };
}

describe('the engine action refuses a malformed ref before echoing it ([R155])', () => {
  const script = stepScript('.github/actions/engine/action.yml', 'ref');

  // [R41]: myst.yml is ungated, so the rule holds on every event.
  it('refuses an unmerged oak pull request, a raw commit or a branch, on any event', () => {
    for (const v of ['refs/pull/7/merge', 'a'.repeat(40), 'main']) {
      const r = refStep(v);
      expect(r.code).toBe(1);
      expect(r.out).toContain('not a release tag');
      expect(r.output).toBe('');
    }
  });

  it('refuses a version below min_engine_version, which skips checks the workflows need', () => {
    for (const v of ['v0.2.0', 'v0.2.10', 'v0.0.0-dev.49']) {
      const r = refStep(v, 'v0.3.0-dev.1');
      expect(r.code).toBe(1);
      expect(r.out).toContain('need v0.3.0-dev.1 or newer');
      expect(r.output).toBe('');
    }
  });

  it('allows min_engine_version and above, its dev releases included', () => {
    for (const v of ['v0.3.0-dev.1', 'v0.3.0-dev.12', 'v0.3.0', 'v0.3.1', 'v0.10.0', 'v1.0.0']) {
      expect(refStep(v, 'v0.3.0-dev.1').code).toBe(0);
    }
  });

  it('refuses a block-scalar version that injects a second $GITHUB_OUTPUT line', () => {
    const r = refStep('v0.0.3\ninjected=PWNED');
    expect(r.code).toBe(1);
    expect(r.output).not.toContain('injected=PWNED');
  });

  it('refuses a version carrying a shell metacharacter', () => {
    for (const v of ['v1;id', 'v1 2', 'v1$(id)', 'v1`id`']) {
      expect(refStep(v).code).toBe(1);
    }
  });

  it('reads the myst.yml in paper-dir, and names it when the version is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-ref-'));
    const bin = mkdtempSync(join(tmpdir(), 'oak-bin-'));
    // yq prints the file it was given, so the test sees which myst.yml the step read.
    writeFileSync(join(bin, 'yq'), '#!/bin/sh\nprintf "%s" "$2" > yq-arg\n');
    chmodSync(join(bin, 'yq'), 0o755);
    const r = run(script, { PATH: `${bin}:${process.env.PATH}`, PAPER_DIR: 'papers/one' }, dir);
    expect(readFileSync(join(dir, 'yq-arg'), 'utf8')).toBe('papers/one/myst.yml');
    expect(r.code).toBe(1);
    expect(r.out).toContain('missing from papers/one/myst.yml');
  });

  it('writes exactly one ref= line for the versions a paper actually pins', () => {
    for (const v of ['v1.2.3', 'v0.0.0-dev.35']) {
      const r = refStep(v);
      expect(r.code).toBe(0);
      expect(r.output.trim()).toBe(`ref=${v}`);
    }
  });
});

describe('the dispatch step takes args as data, not as script ([R153])', () => {
  const script = stepScript('.github/actions/engine/action.yml', 'dispatch');

  /** The runner substitutes `${{ }}` as text before bash sees the script, so the payload is
   *  given both ways: either way the action is written, this is what would reach it. */
  function dispatch(args: string) {
    const dir = mkdtempSync(join(tmpdir(), 'oak-dispatch-'));
    mkdirSync(join(dir, '.engine/ci'), { recursive: true });
    const stub = join(dir, '.engine/ci/run.sh');
    writeFileSync(stub, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > argv\n');
    chmodSync(stub, 0o755);
    const r = run(script.replaceAll('${{ inputs.args }}', args), { ARGS: args }, dir);
    const f = join(dir, 'argv');
    return {
      ...r,
      dir,
      argv: existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [],
    };
  }

  it('does not run a command substitution carried in a tag name', () => {
    // A v* tag reaches the token-bearing publish job; $IFS avoids the space git forbids.
    const d = dispatch('release --tag v1.0.0$(touch${IFS}pwned)');
    expect(existsSync(join(d.dir, 'pwned'))).toBe(false);
    expect(d.argv).toEqual(['release', '--tag', 'v1.0.0$(touch${IFS}pwned)']);
  });

  it('does not run a backquoted command either', () => {
    const d = dispatch('release --tag v1.0.0`touch${IFS}pwned`');
    expect(existsSync(join(d.dir, 'pwned'))).toBe(false);
  });

  it('does not let a metacharacter start a second command', () => {
    const d = dispatch('release --tag v1;touch pwned');
    expect(existsSync(join(d.dir, 'pwned'))).toBe(false);
  });

  it('still splits the verb and its flags into words, as the workflows need', () => {
    expect(dispatch('post-checks --report journal-checks/report.json --repo o/r').argv).toEqual([
      'post-checks',
      '--report',
      'journal-checks/report.json',
      '--repo',
      'o/r',
    ]);
  });

  it('splits without globbing: a word is one argument even if it matches a file', () => {
    const d = dispatch('release --tag v*');
    writeFileSync(join(d.dir, 'v-decoy'), '');
    expect(dispatch('release --tag v*').argv).toEqual(['release', '--tag', 'v*']);
  });
});

describe('no template run: script puts an expression in the script [R153]', () => {
  /** Every `run:` in the template workflows, with its file and step. */
  function runScripts(): Array<{ where: string; script: string }> {
    const files = [
      ...readdirSync(join(SHIM, '.github/workflows')).map((f) => `.github/workflows/${f}`),
      '.github/actions/engine/action.yml',
      '.github/actions/discover/action.yml',
    ];
    const out: Array<{ where: string; script: string }> = [];
    for (const file of files) {
      const doc = parseDocument(readFileSync(join(SHIM, file), 'utf8')).toJS() as {
        runs?: { steps: Array<Record<string, string>> };
        jobs?: Record<string, { steps: Array<Record<string, string>> }>;
      };
      const steps = doc.runs
        ? doc.runs.steps
        : Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
      for (const s of steps)
        if (s.run) out.push({ where: `${file}: ${s.id ?? s.name ?? '(unnamed)'}`, script: s.run });
    }
    return out;
  }

  it('every value a script reads arrives through env:, so none can be spliced', () => {
    const spliced = runScripts().filter((s) => s.script.includes('${{'));
    expect(spliced.map((s) => s.where)).toEqual([]);
  });

  it('finds the scripts it claims to check', () => {
    expect(runScripts().length).toBeGreaterThanOrEqual(3);
  });
});

describe('workflow expressions', () => {
  /** Every `if:` in the template workflows, with its step. */
  function conditions(): Array<{ where: string; expr: string }> {
    const files = [
      ...readdirSync(join(SHIM, '.github/workflows')).map((f) => `.github/workflows/${f}`),
      '.github/actions/engine/action.yml',
      '.github/actions/discover/action.yml',
    ];
    const out: Array<{ where: string; expr: string }> = [];
    for (const file of files) {
      const doc = parseDocument(readFileSync(join(SHIM, file), 'utf8')).toJS() as {
        runs?: { steps: Array<Record<string, string>> };
        jobs?: Record<string, { if?: string; steps: Array<Record<string, string>> }>;
      };
      for (const [name, job] of Object.entries(doc.jobs ?? {}))
        if (job.if) out.push({ where: `${file}: job ${name}`, expr: job.if });
      const steps = doc.runs
        ? doc.runs.steps
        : Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
      for (const s of steps)
        if (s.if) out.push({ where: `${file}: ${s.id ?? s.name ?? '(unnamed)'}`, expr: s.if });
    }
    return out;
  }

  it('no `if:` reads the secrets context', () => {
    // `secrets` cannot be read in an `if:`, and the whole workflow then fails to parse [R172].
    // Read the secret in `env:` and test it in `run:`.
    const offenders = conditions().filter((c) => /\bsecrets\./.test(c.expr));
    expect(offenders.map((c) => c.where)).toEqual([]);
  });

  it('finds the conditions it claims to check', () => {
    expect(conditions().length).toBeGreaterThan(3);
  });

  it('every fromJSON of an engine result tolerates an engine that wrote none', () => {
    // fromJSON('') fails the whole workflow, and an engine older than the templates writes no
    // result.
    const files = readdirSync(join(SHIM, '.github/workflows'));
    const bare = files.flatMap((f) =>
      [...readFileSync(join(SHIM, '.github/workflows', f), 'utf8').matchAll(/fromJSON\(([^)]*)\)/g)]
        .filter((m) => m[1]!.includes('outputs.result') && !m[1]!.includes("|| '{}'"))
        .map((m) => `${f}: ${m[0]}`),
    );
    expect(bare).toEqual([]);
  });
});

describe('every secret a job reads comes from an environment', () => {
  interface Job {
    environment?: string | { name: string };
    steps?: Array<{ uses?: string; with?: Record<string, unknown> }>;
  }
  /** Every job in the template workflows, with the secrets it reads and its environment. */
  function jobs(): Array<{ where: string; secrets: string[]; env: string | null; job: Job }> {
    const out = [];
    for (const f of readdirSync(join(SHIM, '.github/workflows'))) {
      const doc = parseDocument(
        readFileSync(join(SHIM, '.github/workflows', f), 'utf8'),
      ).toJS() as {
        jobs: Record<string, Job>;
      };
      for (const [name, job] of Object.entries(doc.jobs)) {
        const secrets = [...JSON.stringify(job).matchAll(/\bsecrets\.(\w+)/g)].map((m) => m[1]!);
        const env =
          typeof job.environment === 'string' ? job.environment : (job.environment?.name ?? null);
        out.push({ where: `${f}: job ${name}`, secrets, env, job });
      }
    }
    return out;
  }

  it('a job reading a secret declares an environment bootstrap stores that secret on', () => {
    // A repository secret reaches a workflow on any branch, which an author can push.
    const wrong = jobs().flatMap((j) =>
      j.secrets
        .filter((s) => !SECRET_MAP.find((m) => m.name === s)?.envs.includes(j.env ?? ''))
        .map((s) => `${j.where} reads ${s} under ${j.env ?? 'no environment'}`),
    );
    expect(wrong).toEqual([]);
  });

  it('a job holding a secret never installs the paper environment', () => {
    // Installing runs package scripts, which could read the token from the next step.
    const action = parseDocument(
      readFileSync(join(SHIM, '.github/actions/engine/action.yml'), 'utf8'),
    ).toJS() as { runs: { steps: Array<{ uses?: string; if?: string }> } };
    const setup = action.runs.steps.find((s) => s.uses?.startsWith('mamba-org/setup-micromamba'));
    expect(setup?.if).toContain("inputs.paper-env == 'true'");
    const offenders = jobs()
      .filter((j) => j.secrets.length)
      .filter((j) => (j.job.steps ?? []).some((s) => String(s.with?.['paper-env']) === 'true'))
      .map((j) => j.where);
    expect(offenders).toEqual([]);
  });

  it('finds the jobs it claims to check', () => {
    expect(jobs().filter((j) => j.secrets.length).length).toBeGreaterThanOrEqual(3);
  });
});

/** A template workflow, parsed. */
function workflow(file: string): any {
  return parseDocument(readFileSync(join(SHIM, '.github/workflows', file), 'utf8')).toJS();
}

describe('Build paper holds the Pages deploy while the id is the template placeholder', () => {
  it("the build job's output is the engine's placeholder flag", () => {
    const ci = workflow('build-paper.yml');
    expect(ci.jobs.build.outputs.placeholder).toBe(
      "${{ fromJSON(steps.build.outputs.result || '{}').placeholder }}",
    );
    expect(ci.jobs.build.steps.some((s: any) => s.id === 'build')).toBe(true);
  });

  it('the deploy job reads that output', () => {
    expect(workflow('build-paper.yml').jobs['deploy-pages'].if).toContain(
      "needs.build.outputs.placeholder != 'true'",
    );
  });
});

describe('the engine action returns the verb result', () => {
  it('one result output, from the dispatch step', () => {
    const action = parseDocument(
      readFileSync(join(SHIM, '.github/actions/engine/action.yml'), 'utf8'),
    ).toJS() as any;
    expect(Object.keys(action.outputs)).toEqual(['result']);
    expect(action.outputs.result.value).toBe('${{ steps.dispatch.outputs.result }}');
    expect(action.inputs['paper-dir'].default).toBe('.');
  });
});

describe('the templates declare the oldest engine they run with', () => {
  it('pins.yml names a release tag, which bootstrap and upgrade carry into a repo', async () => {
    const { readMinEngine } = await import('../src/upgrade.js');
    const { renderPaperTemplate } = await import('../src/bootstrap.js');
    const min = readMinEngine(SHIM);
    expect(min).toMatch(ENGINE_VERSION);
    const repo = mkdtempSync(join(tmpdir(), 'oak-min-'));
    renderPaperTemplate(SHIM, repo, {
      engineRepo: 'me/engine',
      instanceRepo: 'me/journal',
      owner: '@me',
      version: 'v9.9.9',
      edition: 'e',
    });
    expect(readMinEngine(repo)).toBe(min);
  });
});

describe('version rule parity', () => {
  // The workflows and the release script cannot import TypeScript, so each keeps its own copy of
  // a rule in src/schema.ts.
  /** The pattern of the `[[ ... =~ <pattern> ]]` test in `file`. */
  const pattern = (file: string) => /=~ (\S+) \]\]/.exec(readFileSync(file, 'utf8'))![1]!;
  const matches = (re: string, v: string) =>
    spawnSync('bash', ['-c', `[[ $1 =~ ${re} ]]`, '_', v]).status === 0;
  const engineCopies = ['scripts/cut-engine-release.sh', '.github/workflows/conformance.yml'];
  const stableCopy = '.github/workflows/npm-publish.yml';

  // [input, engine version, stable engine version, paper version tag]
  const cases: Array<[string, boolean, boolean, boolean]> = [
    ['v1.2.3', true, true, true],
    ['v0.0.0', true, true, true],
    ['v0.3.0-dev.12', true, false, false],
    ['v1.2.3-dev.0', true, false, false],
    ['v1.0.0-rc1', false, false, false],
    ['v1.2.3-rc.1', false, false, false],
    ['v1.2.3-0', false, false, false],
    ['v1.2', false, false, false],
    ['1.2.3', false, false, false],
    ['main', false, false, false],
    ['refs/pull/7/merge', false, false, false],
    ['v1.2.3\nx=y', false, false, false],
    ['', false, false, false],
  ];
  it.each(cases)('%j reads the same everywhere', (v, engine, stable, paper) => {
    expect(ENGINE_VERSION.test(v)).toBe(engine);
    expect(isStableEngineVersion(v)).toBe(stable);
    expect(PAPER_VERSION_TAG.test(v)).toBe(paper);
    for (const file of engineCopies) expect(matches(pattern(file), v), file).toBe(engine);
    expect(matches(pattern(stableCopy), v), stableCopy).toBe(stable);
    if (v) expect(refStep(v).code === 0, 'the engine action').toBe(engine);
  });

  // [min_engine_version, pin, passes]
  const order: Array<[string, string, boolean]> = [
    ['v0.3.0-dev.1', 'v0.3.0-dev.2', true],
    ['v0.3.0-dev.10', 'v0.3.0-dev.9', false],
    ['v0.3.0-dev.9', 'v0.3.0', true],
    ['v1.0.0', 'v1.0.0-dev.3', false],
    ['v0.9.9', 'v0.10.0', true],
    ['v1.2.3', 'v1.2.3', true],
    ['v2.0.0', 'v1.99.99', false],
  ];
  it.each(order)(
    'min %s, pin %s: the engine action orders as compareEngineVersions',
    (min, pin, passes) => {
      expect(compareEngineVersions(pin, min)! >= 0).toBe(passes);
      expect(refStep(pin, min).code === 0).toBe(passes);
    },
  );

  it('orders nothing but engine versions', () => {
    expect(compareEngineVersions('main', 'v1.0.0')).toBeNull();
    expect(refStep('v1.0.0', 'v0.3.0-0').code).toBe(1);
  });
});

/* ---- the co-located tier ------------------------------------------------- */

/** Runs `script` in `dir` with a `yq` stub: the query `.engine_version` prints YQ_ENGINE, a
 *  myst.yml query YQ_VALUE, `.min_engine_version` YQ_MIN, a registry query YQ_LOCATIONS. */
function withYq(script: string, dir: string, env: Record<string, string>) {
  const bin = mkdtempSync(join(tmpdir(), 'oak-bin-'));
  writeFileSync(
    join(bin, 'yq'),
    [
      '#!/bin/sh',
      'case "$1" in',
      '  *engine_version*) case "$1" in *min_*) printf "%s" "$YQ_MIN" ;; *) printf "%s" "$YQ_ENGINE" ;; esac ;;',
      '  *location*) printf "%s\\n" "$YQ_LOCATIONS" ;;',
      '  *) printf "%s" "$YQ_VALUE" ;;',
      'esac',
    ].join('\n') + '\n',
  );
  chmodSync(join(bin, 'yq'), 0o755);
  const outFile = join(dir, 'gh_output');
  writeFileSync(outFile, '');
  const r = run(
    script,
    { PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: outFile, ...env },
    dir,
  );
  return { ...r, output: readFileSync(outFile, 'utf8') };
}

describe('the ref step in a co-located repository', () => {
  const script = stepScript('.github/actions/engine/action.yml', 'ref');
  const colocated = () => {
    const dir = mkdtempSync(join(tmpdir(), 'oak-colo-ref-'));
    mkdirSync(join(dir, 'papers', 'a-1'), { recursive: true });
    return dir;
  };

  it('refuses a paper-dir that is not . or papers/<id>, before reading any file', () => {
    for (const d of ['../x', 'papers/../x', 'papers/a/b', 'other/a', 'papers/.x', 'papers/a\nb']) {
      const r = withYq(script, colocated(), { PAPER_DIR: d, YQ_VALUE: 'v1.0.0' });
      expect(r.code, d).toBe(1);
      expect(r.out, d).toContain('paper-dir must be');
      expect(r.output, d).toBe('');
    }
  });

  it("a job with no paper of its own runs pins.yml's engine_version", () => {
    const r = withYq(script, colocated(), {
      PAPER_DIR: '.',
      YQ_ENGINE: 'v2.0.0',
      YQ_VALUE: 'v1.0.0',
    });
    expect(r.code).toBe(0);
    expect(r.output.trim()).toBe('ref=v2.0.0');
  });

  it('holds engine_version to the same rules as a paper pin', () => {
    const missing = withYq(script, colocated(), { PAPER_DIR: '.', YQ_ENGINE: '' });
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('engine_version missing from .github/actions/engine/pins.yml');
    const branch = withYq(script, colocated(), { PAPER_DIR: '.', YQ_ENGINE: 'main' });
    expect(branch.code).toBe(1);
    const old = withYq(script, colocated(), {
      PAPER_DIR: '.',
      YQ_ENGINE: 'v0.1.0',
      YQ_MIN: 'v0.4.0-dev.1',
    });
    expect(old.code).toBe(1);
  });

  it("a paper's job runs its own pin", () => {
    const r = withYq(script, colocated(), {
      PAPER_DIR: 'papers/a-1',
      YQ_ENGINE: 'v2.0.0',
      YQ_VALUE: 'v1.0.0',
    });
    expect(r.output.trim()).toBe('ref=v1.0.0');
  });
});

describe('the discover action', () => {
  const script = stepScript('.github/actions/discover/action.yml', 'discover');
  const git = (dir: string, ...args: string[]) =>
    spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);

  /** A repo with `papers` committed, then a second commit changing `changed`. */
  function repo(papers: string[] | null, changed: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'oak-discover-'));
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'journal.yml'), 'name: J\n');
    mkdirSync(join(dir, 'registry'));
    writeFileSync(join(dir, 'registry', 'papers.yml'), '[]\n'); // yq is stubbed: YQ_LOCATIONS
    for (const id of papers ?? []) {
      mkdirSync(join(dir, 'papers', id), { recursive: true });
      writeFileSync(join(dir, 'papers', id, 'myst.yml'), 'version: 1\n');
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    for (const f of changed) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), 'changed\n');
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'change');
    return dir;
  }
  const discover = (dir: string, env: Record<string, string>) => {
    const r = withYq(script, dir, env);
    const line = (k: string) =>
      r.output
        .split('\n')
        .find((l) => l.startsWith(`${k}=`))
        ?.slice(k.length + 1);
    return {
      ...r,
      papers: line('papers') ? JSON.parse(line('papers')!) : null,
      colocated: line('colocated'),
    };
  };
  const dirs = (p: Array<{ dir: string }>) => p.map((x) => x.dir);

  it('is the paper at the root in a paper repository', () => {
    const d = discover(repo(null, ['index.md']), { FOR: 'build', EVENT: 'push' });
    expect(d.papers).toEqual([{ dir: '.', key: '' }]);
    expect(d.colocated).toBe('false');
  });

  it('builds the listed papers on a push, and no draft', () => {
    const d = discover(repo(['a-1', 'b-2', 'c-3'], ['papers/a-1/index.md']), {
      FOR: 'build',
      EVENT: 'push',
      YQ_LOCATIONS: './papers/a-1\n./papers/c-3/\nacme/external\n./papers/a-10',
    });
    expect(d.papers).toEqual([
      { dir: 'papers/a-1', key: 'a-1' },
      { dir: 'papers/c-3', key: 'c-3' },
    ]);
    expect(d.colocated).toBe('true');
  });

  it('checks every paper on a push', () => {
    const d = discover(repo(['a-1', 'b-2'], ['x.md']), { FOR: 'check', EVENT: 'push' });
    expect(dirs(d.papers)).toEqual(['papers/a-1', 'papers/b-2']);
  });

  it('on a pull request, builds and checks the papers it changes', () => {
    const dir = repo(['a-1', 'b-2', 'c-3'], ['papers/a-1/index.md', 'papers/c-3/fig.png']);
    for (const FOR of ['build', 'check'])
      expect(dirs(discover(dir, { FOR, EVENT: 'pull_request' }).papers)).toEqual([
        'papers/a-1',
        'papers/c-3',
      ]);
  });

  it('a pull request changing anything outside papers/ checks every paper, and builds the changed ones', () => {
    const dir = repo(['a-1', 'b-2'], ['registry/papers.yml', 'papers/b-2/index.md']);
    expect(dirs(discover(dir, { FOR: 'check', EVENT: 'pull_request' }).papers)).toEqual([
      'papers/a-1',
      'papers/b-2',
    ]);
    expect(dirs(discover(dir, { FOR: 'build', EVENT: 'pull_request' }).papers)).toEqual([
      'papers/b-2',
    ]);
  });

  it('a pull request changing no paper gives an empty list', () => {
    const d = discover(repo(['a-1'], ['pages/index.md']), { FOR: 'build', EVENT: 'pull_request' });
    expect(d.papers).toEqual([]);
  });

  it('a new paper on a pull request is found', () => {
    const d = discover(repo([], ['papers/n-1/myst.yml']), { FOR: 'build', EVENT: 'pull_request' });
    expect(dirs(d.papers)).toEqual(['papers/n-1']);
  });

  it('fails on a folder not named by a paper id, which would become a path and an artifact name', () => {
    const d = discover(repo(['a-1'], ['papers/x.y/myst.yml']), { FOR: 'check', EVENT: 'push' });
    expect(d.code).toBe(1);
    expect(d.out).toContain('is not named by a paper id');
    expect(d.output).not.toContain('papers=');
  });
});

describe('the deposit tag and the reserve-doi input name the paper', () => {
  const tagStep = stepScript('.github/workflows/deposit-version.yml', 'tag');
  const paperStep = stepScript('.github/workflows/reserve-doi.yml', 'paper');

  it.each([
    ['v1.2.3', '.'],
    ['a-2026-x/v1.0.0', 'papers/a-2026-x'],
  ])('tag %s builds and deposits %s', (tag, dir) => {
    const r = withYq(tagStep, mkdtempSync(join(tmpdir(), 'oak-tag-')), { TAG: tag });
    expect(r.code).toBe(0);
    expect(r.output.trim()).toBe(`paper-dir=${dir}`);
  });

  it.each(['v1.2', '../x/v1.0.0', 'a/b/v1.0.0', 'a/v1.0.0\npaper-dir=.', 'a$(id)/v1.0.0'])(
    'refuses tag %j',
    (tag) => {
      const r = withYq(tagStep, mkdtempSync(join(tmpdir(), 'oak-tag-')), { TAG: tag });
      expect(r.code).toBe(1);
      expect(r.output).toBe('');
    },
  );

  it('reserve-doi takes an id with a folder in papers/, or nothing in a paper repository', () => {
    const colo = mkdtempSync(join(tmpdir(), 'oak-rdoi-'));
    mkdirSync(join(colo, 'papers', 'a-1'), { recursive: true });
    writeFileSync(join(colo, 'papers', 'a-1', 'myst.yml'), '');
    expect(withYq(paperStep, colo, { PAPER: 'a-1' }).output.trim()).toBe('paper-dir=papers/a-1');
    for (const bad of ['', 'b-2', '../a-1', 'a-1/..'])
      expect(withYq(paperStep, colo, { PAPER: bad }).code, bad).toBe(1);
    const paperRepo = mkdtempSync(join(tmpdir(), 'oak-rdoi-'));
    expect(withYq(paperStep, paperRepo, { PAPER: '' }).output.trim()).toBe('paper-dir=.');
    expect(withYq(paperStep, paperRepo, { PAPER: 'a-1' }).code).toBe(1);
  });
});

describe('paper id rule parity', () => {
  // The launchers cannot import TypeScript, so each keeps a copy of PAPER_ID in src/projects.ts.
  const copies: Array<[string, RegExp]> = [
    ['.github/actions/engine/action.yml', /papers\/(\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,99\})/],
    ['.github/actions/discover/action.yml', /id='\^(\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,99\})\$'/],
    ['.github/workflows/deposit-version.yml', /\^\((\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,99\})\)\/v/],
    ['.github/workflows/reserve-doi.yml', /\^(\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,99\})\$/],
  ];
  it('every copy is PAPER_ID', async () => {
    const { PAPER_ID } = await import('../src/projects.js');
    for (const [file, re] of copies) {
      const m = re.exec(readFileSync(join(SHIM, file), 'utf8'));
      expect(m, file).not.toBeNull();
      expect(`^${m![1]}$`, file).toBe(PAPER_ID.source);
    }
  });
});

describe('the launchers carry the paper folder through every workflow', () => {
  it('each engine call that works on one paper passes paper-dir', () => {
    const calls: Array<[string, string, string | undefined]> = [];
    for (const f of readdirSync(join(SHIM, '.github/workflows'))) {
      for (const [name, job] of Object.entries(workflow(f).jobs as Record<string, any>))
        for (const s of job.steps ?? [])
          if (s.uses === './.github/actions/engine')
            calls.push([`${f}: ${name}`, s.with.args, s.with['paper-dir']]);
    }
    // Stage 2 and the website are the repository's own: the engine reads their paper from the
    // artifacts.
    const repoLevel = ['deploy-preview', 'post-checks', 'assemble'];
    for (const [where, args, dir] of calls) {
      if (repoLevel.some((v) => args.startsWith(v))) expect(dir, where).toBeUndefined();
      else
        expect(dir, where).toMatch(
          /^\$\{\{ (matrix\.paper\.dir|steps\.\w+\.outputs\.paper-dir) \}\}$/,
        );
    }
  });
});
