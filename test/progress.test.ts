/**
 * The lines and the spinner of `oak release` (progress.ts `waitIndicator`), on a fake stream with
 * fake timers: each step starts with the time, the spinner and what oak waits for are drawn only
 * while it waits on a terminal and erased before anything else is written, and the last block
 * has no time.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { stamp, waitIndicator } from '../src/progress.js';

const ERASE = '\r\u001b[K';
const AT = new Date(2026, 10, 8, 9, 5, 7);
const now = () => AT;

function stream(isTTY: boolean) {
  const writes: string[] = [];
  return { isTTY, writes, write: (text: string) => void writes.push(text) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the lines oak release logs', () => {
  it('start with the local time, 24-hour with leading zeros', () => {
    expect(stamp(AT)).toBe('[09:05:07] ');
    expect(stamp(new Date(2026, 10, 8, 23, 59, 0))).toBe('[23:59:00] ');
  });
});

describe('the spinner', () => {
  it('turns during a sleep and is erased before the sleep resolves', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {}, now);
    const done = w.sleep(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    const frames = out.writes.filter((t) => /^\r\u001b\[K[|/\\-]$/.test(t));
    expect(frames.length).toBeGreaterThanOrEqual(10);
    expect(new Set(frames.map((f) => f[ERASE.length])).size).toBe(4);
    expect(out.writes.at(-1)).toBe(ERASE);
  });

  it('erases itself before a logged line, which gets a line of its own', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {}, now);
    void w.sleep(1000);
    await vi.advanceTimersByTimeAsync(200);
    w.log('oak release: still waiting');
    expect(out.writes.slice(-2)).toEqual([ERASE, '[09:05:07] oak release: still waiting\n']);
    w.clear();
  });

  it('clear stops it, for the Ctrl-C message', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {}, now);
    void w.sleep(10_000);
    await vi.advanceTimersByTimeAsync(200);
    w.clear();
    const n = out.writes.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.writes.length).toBe(n);
    expect(out.writes.at(-1)).toBe(ERASE);
  });

  it('is not drawn off a terminal, in CI, or with TERM=dumb, where lines still start with the time', async () => {
    vi.useFakeTimers();
    for (const [isTTY, env] of [
      [false, {}],
      [true, { CI: 'true' }],
      [true, { TERM: 'dumb' }],
    ] as const) {
      const out = stream(isTTY);
      const w = waitIndicator(out, env, now);
      const done = w.sleep(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      w.log('oak release: queued');
      expect(out.writes).toEqual(['[09:05:07] oak release: queued\n']);
    }
  });
});

describe('what oak waits for', () => {
  it('follows the spinner on a terminal, and is erased with it', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {}, now);
    w.status('Deposit version: build job in progress');
    expect(out.writes).toEqual([]);
    const done = w.sleep(200);
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(out.writes[0]).toMatch(/^\r\u001b\[K[|/\\-] Deposit version: build job in progress$/);
    expect(out.writes.at(-1)).toBe(ERASE);
  });

  it('is logged when it changes, off a terminal', () => {
    const out = stream(false);
    const w = waitIndicator(out, {}, now);
    w.status('Deposit version: queued');
    w.status('Deposit version: queued');
    w.status('Deposit version: build job in progress');
    expect(out.writes).toEqual([
      '[09:05:07] Deposit version: queued\n',
      '[09:05:07] Deposit version: build job in progress\n',
    ]);
  });

  it('spins while other work runs, and gives back its result', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {}, now);
    const work = new Promise<number>((done) => setTimeout(() => done(7), 300));
    const result = w.during(work);
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toBe(7);
    const frames = out.writes.filter((t) => t.startsWith(ERASE) && t.length > ERASE.length);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(out.writes.at(-1)).toBe(ERASE);
  });
});

describe('the last block', () => {
  it('comes after a blank line, with no time', () => {
    const out = stream(false);
    const w = waitIndicator(out, {}, now);
    w.log('✓ tagged v1.0.0 at abc1234');
    w.next([
      'Next: check the draft on Zenodo, then click Publish:',
      '  https://zenodo.org/uploads/5',
    ]);
    expect(out.writes.join('')).toBe(
      '[09:05:07] ✓ tagged v1.0.0 at abc1234\n' +
        '\nNext: check the draft on Zenodo, then click Publish:\n  https://zenodo.org/uploads/5\n',
    );
  });
});
