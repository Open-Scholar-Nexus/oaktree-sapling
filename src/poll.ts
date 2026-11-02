/**
 * poll.ts: the wait loop `oak conformance` and `oak release` share. Each caller words its own
 * timeout. Tests pass a `sleep` that returns at once.
 */

export interface PollOpts {
  tries: number;
  intervalMs: number;
}

/**
 * Calls `attempt` until it returns a value, at most `opts.tries` times, sleeping between calls;
 * `null` means keep waiting, and a throw ends the wait. Returns null when every try said wait.
 */
export async function pollUntil<T>(
  attempt: () => T | null,
  sleep: (ms: number) => Promise<void>,
  opts: PollOpts,
): Promise<T | null> {
  for (let i = 0; i < opts.tries; i++) {
    const ready = attempt();
    if (ready !== null) return ready;
    if (i < opts.tries - 1) await sleep(opts.intervalMs);
  }
  return null;
}
