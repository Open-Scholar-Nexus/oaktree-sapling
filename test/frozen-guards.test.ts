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

describe('the engine action refuses an untrusted ref class ([R41])', () => {
  const script = stepScript('.github/actions/engine/action.yml', 'refclass');

  it('refuses an unmerged oak pull request from a fork', () => {
    const r = run(script, { REF: 'refs/pull/7/merge', IS_FORK: 'true' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('unmerged pull request');
  });

  it('refuses a raw commit from a fork', () => {
    const r = run(script, { REF: 'a'.repeat(40), IS_FORK: 'true' });
    expect(r.code).toBe(1);
  });

  it('allows the refs a paper is supposed to pin', () => {
    for (const ref of ['v1.2.3', 'v0.0.0-dev.18', 'main']) {
      expect(run(script, { REF: ref, IS_FORK: 'true' }).code).toBe(0);
    }
  });

  it('leaves same-repo dogfooding alone', () => {
    expect(run(script, { REF: 'refs/pull/7/merge', IS_FORK: 'false' }).code).toBe(0);
  });
});

describe('the engine action refuses a malformed ref before echoing it ([R155])', () => {
  const script = stepScript('.github/actions/engine/action.yml', 'ref');

  /** Runs the ref step with `yq` stubbed to print `value`, and a real GITHUB_OUTPUT file. */
  function refStep(value: string) {
    const dir = mkdtempSync(join(tmpdir(), 'oak-ref-'));
    const bin = mkdtempSync(join(tmpdir(), 'oak-bin-'));
    writeFileSync(join(dir, 'myst.yml'), 'project: {}');
    writeFileSync(join(bin, 'yq'), `#!/bin/sh\nprintf '%s' "$YQ_VALUE"\n`);
    chmodSync(join(bin, 'yq'), 0o755);
    const outFile = join(dir, 'gh_output');
    writeFileSync(outFile, '');
    const r = run(
      script,
      { PATH: `${bin}:${process.env.PATH}`, YQ_VALUE: value, GITHUB_OUTPUT: outFile },
      dir,
    );
    return { ...r, output: readFileSync(outFile, 'utf8') };
  }

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
    for (const v of ['v1.2.3', 'v0.0.0-dev.35', 'refs/pull/7/merge', 'a'.repeat(40), 'main']) {
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
    expect(dispatch('check-post --report journal-checks/report.json --repo o/r').argv).toEqual([
      'check-post',
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
    expect(runScripts().length).toBeGreaterThanOrEqual(4);
  });
});

describe('workflow expressions', () => {
  /** Every `if:` in the template workflows, with its step. */
  function conditions(): Array<{ where: string; expr: string }> {
    const files = [
      ...readdirSync(join(SHIM, '.github/workflows')).map((f) => `.github/workflows/${f}`),
      '.github/actions/engine/action.yml',
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
        .filter((m) => !m[1]!.includes("|| '{}'"))
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

describe('Paper CI holds the Pages deploy while the id is the template placeholder', () => {
  it("the build job's output is the engine's placeholder flag", () => {
    const ci = workflow('ci.yml');
    expect(ci.jobs.build.outputs.placeholder).toBe(
      "${{ fromJSON(steps.build.outputs.result || '{}').placeholder }}",
    );
    expect(ci.jobs.build.steps.some((s: any) => s.id === 'build')).toBe(true);
  });

  it('the deploy job reads that output', () => {
    expect(workflow('ci.yml').jobs['deploy-pages'].if).toContain(
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
    expect(min).toMatch(/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
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

function stubbedStep(script: string, tool: string, value: string) {
  const dir = mkdtempSync(join(tmpdir(), 'oak-step-'));
  const bin = mkdtempSync(join(tmpdir(), 'oak-bin-'));
  writeFileSync(join(dir, 'myst.yml'), 'project: {}');
  writeFileSync(join(bin, tool), `#!/bin/sh\nprintf '%s' "$STUB_VALUE"\n`);
  chmodSync(join(bin, tool), 0o755);
  const outFile = join(dir, 'gh_output');
  writeFileSync(outFile, '');
  const r = run(
    script,
    { PATH: `${bin}:${process.env.PATH}`, STUB_VALUE: value, GITHUB_OUTPUT: outFile },
    dir,
  );
  return { ...r, output: readFileSync(outFile, 'utf8') };
}

describe('prepare finds the DOI pull request it checks', () => {
  const script = stepScript('.github/workflows/prepare.yml', 'pr');

  it('passes on the number and head commit', () => {
    const sha = 'a'.repeat(40);
    const r = stubbedStep(script, 'gh', `12 ${sha}`);
    expect(r.code).toBe(0);
    expect(r.output).toBe(`number=12\nsha=${sha}\n`);
  });

  it('does nothing when no DOI pull request is open', () => {
    const r = stubbedStep(script, 'gh', '');
    expect(r.code).toBe(0);
    expect(r.output).toBe('');
  });

  it('refuses an answer that is not a number and a commit', () => {
    const r = stubbedStep(script, 'gh', '12 main\nsha=evil');
    expect(r.code).toBe(1);
    expect(r.output).toBe('');
  });
});

describe('the sandbox-token guard refuses an unset token ([R172])', () => {
  const script = stepScript(
    '.github/workflows/prepare.yml',
    undefined,
    'Refuse a sandbox run with no sandbox token',
  );

  it('refuses when the sandbox token is unset', () => {
    const r = run(script, { SANDBOX_TOKEN: '' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('refusing to fall back to the production token');
  });

  it('allows the run when the sandbox token is set', () => {
    expect(run(script, { SANDBOX_TOKEN: 'a-token' }).code).toBe(0);
  });
});
