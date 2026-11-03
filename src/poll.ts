/**
 * poll.ts: a wait loop used by `oak conformance` and `oak release`. It returns null at the limit,
 * and each caller throws its own error with its own message. Tests pass a `sleep` that resolves
 * immediately, so a wait takes no real time.
 */

export interface PollOpts {
  tries: number;
  intervalMs: number;
}

/**
 * Calls `attempt` up to `opts.tries` times, sleeping `opts.intervalMs` between calls. Each call of
 * `attempt` either:
 * - returns a value: the wait is over and `pollUntil` returns it;
 * - returns null: not ready yet, so it is called again after the sleep;
 * - throws: the wait ends and the error reaches the caller.
 * Returns null when every call returned null.
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
