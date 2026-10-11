/**
 * The files Stage 1 leaves for Stage 2 and the pull request check before Stage 2 writes to a
 * pull request [R26] [R136]. Each refusal is tested with the input it refuses; the live run
 * cannot produce a forged artifact.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKS_FILES,
  SITE_FILES,
  eventHeadSha,
  eventPrNumber,
  readPaperDir,
  readPrNumber,
  resolvePaperDir,
  takePaperDir,
  verifyPrHead,
  writeStage1Files,
} from '../src/artifact.js';
import { UserError } from '../src/messages.js';

const HEAD = 'a'.repeat(40);

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'oak-artifact-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

/** A GitHub event file, and the env naming it. */
function event(name: string, payload: unknown) {
  const f = join(mkdtempSync(join(tmpdir(), 'oak-event-')), 'event.json');
  writeFileSync(f, JSON.stringify(payload));
  return { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: f };
}

describe('verifyPrHead, the check before Stage 2 writes to a pull request [R136]', () => {
  const asked: string[] = [];
  const lookup = (head: string) => (repo: string, pr: string) => {
    asked.push(`${repo}#${pr}`);
    return head;
  };

  it('passes the pull request this run built', () => {
    expect(() => verifyPrHead('o/r', '7', HEAD, lookup(HEAD))).not.toThrow();
  });

  it('refuses a real pull request whose head is another commit', () => {
    expect(() => verifyPrHead('o/r', '99', HEAD, lookup('b'.repeat(40)))).toThrow(
      /#99 heads at b{40}, not at a{40}/,
    );
  });

  it('refuses a number that is not one, before asking GitHub', () => {
    asked.length = 0;
    for (const forged of ['1/comments?x=', '../../user/repos', '7\n8', '12345678901', '']) {
      expect(() => verifyPrHead('o/r', forged, HEAD, lookup(HEAD))).toThrow(UserError);
    }
    expect(asked).toEqual([]);
  });

  it('refuses without a commit to compare with, or with something that is not a commit', () => {
    expect(() => verifyPrHead('o/r', '7', undefined, lookup(HEAD))).toThrow(/--verified-head/);
    expect(() => verifyPrHead('o/r', '7', 'main', lookup('main'))).toThrow(/--verified-head/);
  });

  it('refuses without a repo', () => {
    expect(() => verifyPrHead(null, '7', HEAD, lookup(HEAD))).toThrow(/--repo/);
  });
});

describe('readPrNumber', () => {
  it('reads pr-number beside the report', () => {
    expect(readPrNumber(dirWith({ 'pr-number': '12\n' }))).toBe('12');
  });

  it('is null for a push build, which writes none', () => {
    expect(readPrNumber(dirWith({}))).toBeNull();
  });

  it('refuses a forged one', () => {
    expect(() => readPrNumber(dirWith({ 'pr-number': '12/comments' }))).toThrow(
      /not a pull request number/,
    );
  });
});

describe('the paper folder in the artifact', () => {
  it('an artifact from before the file existed reads as none, which means `.`', () => {
    const old = dirWith({ 'report.json': '{}', 'pr-number': '3\n' });
    expect(readPaperDir(old)).toBeNull();
    expect(resolvePaperDir(undefined, readPaperDir(old))).toBe('.');
  });

  it('reads a folder below the repo root', () => {
    expect(readPaperDir(dirWith({ paper: 'papers/one\n' }))).toBe('papers/one');
    expect(readPaperDir(dirWith({ paper: '.\n' }))).toBe('.');
  });

  it('refuses a folder outside the repo root, or a hidden one', () => {
    for (const forged of ['..', '../other', 'papers/../../x', '/etc', '.github', 'a\nb', 'a b']) {
      expect(() => readPaperDir(dirWith({ paper: forged }))).toThrow(/not a folder below/);
    }
  });

  it('takePaperDir removes .paper from a site, even when refused', () => {
    const ok = dirWith({ '.paper': 'papers/one' });
    expect(takePaperDir(ok)).toBe('papers/one');
    expect(existsSync(join(ok, '.paper'))).toBe(false);
    const bad = dirWith({ '.paper': '../x' });
    expect(() => takePaperDir(bad)).toThrow();
    expect(existsSync(join(bad, '.paper'))).toBe(false);
  });

  it('resolvePaperDir takes either source, and refuses two that disagree', () => {
    expect(resolvePaperDir('papers/one', null)).toBe('papers/one');
    expect(resolvePaperDir(undefined, 'papers/one')).toBe('papers/one');
    expect(resolvePaperDir('.', 'papers/one')).toBe('papers/one');
    expect(resolvePaperDir('papers/one/', 'papers/one')).toBe('papers/one');
    expect(() => resolvePaperDir('papers/two', 'papers/one')).toThrow(/papers\/one.*papers\/two/);
  });
});

describe('the GitHub event', () => {
  it('a pull_request run has a number', () => {
    expect(eventPrNumber(event('pull_request', { pull_request: { number: 7 } }))).toBe('7');
  });

  it('any other run has none, even with a pull_request field', () => {
    expect(eventPrNumber(event('push', { pull_request: { number: 7 } }))).toBeNull();
    expect(eventPrNumber({})).toBeNull();
  });

  it('a workflow_run run names the commit Stage 1 built', () => {
    expect(eventHeadSha(event('workflow_run', { workflow_run: { head_sha: HEAD } }))).toBe(HEAD);
    expect(eventHeadSha(event('workflow_dispatch', { workflow_run: { head_sha: HEAD } }))).toBe(
      undefined,
    );
  });
});

describe('writeStage1Files', () => {
  it('writes the number and the paper folder on a pull_request run', () => {
    const repo = mkdtempSync(join(tmpdir(), 'oak-repo-'));
    const out = join(repo, 'papers/one/_build/html');
    mkdirSync(out, { recursive: true });
    const env = event('pull_request', { pull_request: { number: 7 } });
    expect(writeStage1Files(out, SITE_FILES, join(repo, 'papers/one'), repo, env)).toBe(true);
    expect(readFileSync(join(out, '.pr-number'), 'utf8')).toBe('7\n');
    expect(readFileSync(join(out, '.paper'), 'utf8')).toBe('papers/one\n');
  });

  it('a paper at the repo root is `.`, under the names the checks artifact uses', () => {
    const repo = mkdtempSync(join(tmpdir(), 'oak-repo-'));
    const env = event('pull_request', { pull_request: { number: 7 } });
    writeStage1Files(repo, CHECKS_FILES, repo, repo, env);
    expect(readFileSync(join(repo, 'pr-number'), 'utf8')).toBe('7\n');
    expect(readFileSync(join(repo, 'paper'), 'utf8')).toBe('.\n');
  });

  it('writes nothing on a push or a dispatch', () => {
    const repo = mkdtempSync(join(tmpdir(), 'oak-repo-'));
    expect(writeStage1Files(repo, CHECKS_FILES, repo, repo, event('push', {}))).toBe(false);
    expect(existsSync(join(repo, 'pr-number'))).toBe(false);
    expect(existsSync(join(repo, 'paper'))).toBe(false);
  });
});
