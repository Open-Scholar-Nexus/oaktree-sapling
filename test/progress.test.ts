/**
 * The waiting line `oak release` draws (progress.ts `waitIndicator`), on a fake stream with fake
 * timers: drawn only during a sleep on a terminal, erased before anything else is written.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitIndicator } from '../src/progress.js';

const ERASE = '\r\u001b[K';

function stream(isTTY: boolean) {
  const writes: string[] = [];
  return { isTTY, writes, write: (text: string) => void writes.push(text) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the waiting line', () => {
  it('turns during a sleep and is erased before the sleep resolves', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {});
    const done = w.sleep(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    const frames = out.writes.filter((t) => /^\r\u001b\[K[|/\\-] \d+:\d\d$/.test(t));
    expect(frames.length).toBeGreaterThanOrEqual(10);
    expect(new Set(frames.map((f) => f[ERASE.length])).size).toBe(4);
    expect(out.writes.at(-1)).toBe(ERASE);
  });

  it('shows the time since the last line', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {});
    const first = w.sleep(65_000);
    await vi.advanceTimersByTimeAsync(65_000);
    await first;
    expect(out.writes.some((t) => t.endsWith(' 1:04'))).toBe(true);
    w.log('oak release: build in progress');
    const second = w.sleep(100);
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(out.writes.at(-2)).toMatch(/ 0:00$/);
  });

  it('erases itself before a logged line, which gets a line of its own', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {});
    void w.sleep(1000);
    await vi.advanceTimersByTimeAsync(200);
    w.log('oak release: still waiting');
    expect(out.writes.slice(-2)).toEqual([ERASE, 'oak release: still waiting\n']);
    w.clear();
  });

  it('clear stops it, for the Ctrl-C message', async () => {
    vi.useFakeTimers();
    const out = stream(true);
    const w = waitIndicator(out, {});
    void w.sleep(10_000);
    await vi.advanceTimersByTimeAsync(200);
    w.clear();
    const n = out.writes.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.writes.length).toBe(n);
    expect(out.writes.at(-1)).toBe(ERASE);
  });

  it('writes whole lines only off a terminal, in CI, or with TERM=dumb', async () => {
    vi.useFakeTimers();
    for (const [isTTY, env] of [
      [false, {}],
      [true, { CI: 'true' }],
      [true, { TERM: 'dumb' }],
    ] as const) {
      const out = stream(isTTY);
      const w = waitIndicator(out, env);
      const done = w.sleep(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      w.log('oak release: queued');
      expect(out.writes).toEqual(['oak release: queued\n']);
    }
  });
});
