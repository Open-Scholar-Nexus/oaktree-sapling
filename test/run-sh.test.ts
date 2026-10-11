/**
 * ci/run.sh, run as bash with a stub in place of the bundle: the verb's result reaches
 * `$GITHUB_OUTPUT` as one line, the verb's exit code survives, and a paper folder becomes
 * `--paper`.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** An engine checkout whose bundle records its argv and writes `result` as its result. */
function engine(result: unknown, exitCode = 0): string {
  const dir = mkdtempSync(join(tmpdir(), 'oak-runsh-'));
  mkdirSync(join(dir, 'ci'));
  mkdirSync(join(dir, 'dist'));
  copyFileSync('ci/run.sh', join(dir, 'ci', 'run.sh'));
  writeFileSync(
    join(dir, 'dist', 'cli.cjs'),
    `const fs = require('fs');
fs.writeFileSync(${JSON.stringify(join(dir, 'argv'))}, JSON.stringify(process.argv.slice(2)));
if (${JSON.stringify(result)} !== null) fs.writeFileSync(process.env.OAK_RESULT_FILE, ${JSON.stringify(JSON.stringify(result))});
process.exit(${exitCode});
`,
  );
  return dir;
}

function run(dir: string, args: string[], env: Record<string, string> = {}) {
  const output = join(dir, 'gh_output');
  writeFileSync(output, '');
  const r = spawnSync('bash', [join(dir, 'ci', 'run.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: output, INSTANCE_REPO: '.', ...env },
  });
  return {
    code: r.status,
    output: readFileSync(output, 'utf8'),
    argv: JSON.parse(readFileSync(join(dir, 'argv'), 'utf8')) as string[],
  };
}

describe('ci/run.sh', () => {
  it('writes the result as one result= line, whatever the strings in it hold', () => {
    const result = { status: 'error', message: 'line one\nforged=1', pr_number: '7' };
    const r = run(engine(result), ['check-post']);
    expect(r.output.split('\n').filter(Boolean)).toHaveLength(1);
    expect(r.output.startsWith('result=')).toBe(true);
    expect(JSON.parse(r.output.slice('result='.length))).toEqual(result);
  });

  it("keeps the verb's exit code", () => {
    const r = run(engine({ status: 'error' }, 3), ['check-post']);
    expect(r.code).toBe(3);
    expect(r.output).toContain('result=');
  });

  it('writes no output when the verb recorded no result', () => {
    const r = run(engine(null, 2), ['check-post']);
    expect(r.code).toBe(2);
    expect(r.output).toBe('');
  });

  it('passes a paper folder as --paper, after the arguments the workflow gave', () => {
    const dir = engine({ status: 'ok' });
    expect(run(dir, ['validate', '--report', 'r.json'], { PAPER_DIR: 'papers/one' }).argv).toEqual([
      'validate',
      '--report',
      'r.json',
      '--paper',
      'papers/one',
    ]);
    expect(run(dir, ['validate'], { PAPER_DIR: '.' }).argv).toEqual(['validate']);
    expect(run(dir, ['upgrade', '--paper', '.'], { PAPER_DIR: 'papers/one' }).argv).toEqual([
      'upgrade',
      '--paper',
      '.',
    ]);
  });
});
