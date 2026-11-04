/** The wait loop conformance and release share: tries, sleeps between them, null at the limit. */
import { describe, it, expect } from 'vitest';
import { pollUntil } from '../src/poll.js';

describe('pollUntil', () => {
  it('returns the first value, sleeping only between tries', async () => {
    const slept: number[] = [];
    let n = 0;
    const got = await pollUntil(
      () => (++n === 3 ? 'ready' : null),
      async (ms) => void slept.push(ms),
      { tries: 5, intervalMs: 10 },
    );
    expect(got).toBe('ready');
    expect(slept).toEqual([10, 10]);
  });

  it('returns null once every try said wait, with no sleep after the last', async () => {
    const slept: number[] = [];
    let n = 0;
    const got = await pollUntil(
      () => (n++, null),
      async (ms) => void slept.push(ms),
      { tries: 3, intervalMs: 10 },
    );
    expect(got).toBeNull();
    expect(n).toBe(3);
    expect(slept).toEqual([10, 10]);
  });

  it('ends the wait on a throw', async () => {
    await expect(
      pollUntil(
        () => {
          throw new Error('failed');
        },
        async () => {},
        { tries: 3, intervalMs: 10 },
      ),
    ).rejects.toThrow('failed');
  });
});
