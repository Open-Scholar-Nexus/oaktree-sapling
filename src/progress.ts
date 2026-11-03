/**
 * progress.ts: the spinner `oak release` shows on a terminal while it waits for the Deposit version
 * run.
 *
 * It is drawn only during a sleep and erased before the sleep resolves, so the gh calls between
 * sleeps (gh.ts `showWorking`) and every logged line start on a clear line.
 */

/** ASCII, so no terminal needs UTF-8 for it. */
const FRAMES = ['|', '/', '-', '\\'];
const FRAME_MS = 100;
/** Back to the start of the line, then erase it. */
const ERASE = '\r\u001b[K';

/** The part of a stream {@link waitIndicator} uses. */
export interface ProgressStream {
  isTTY?: boolean;
  write(text: string): unknown;
}

export interface WaitIndicator {
  /** Waits `ms`, drawing the line meanwhile; it is erased when this resolves. */
  sleep(ms: number): Promise<void>;
  /** Writes `line` on a line of its own and restarts the time shown. */
  log(line: string): void;
  /** Erases the line if it is drawn, before something else writes to the stream. */
  clear(): void;
}

/** `m:ss`. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A {@link WaitIndicator} on `stream`: a spinner and the time since the last line, on a
 * terminal outside CI, as gh.ts `showWorking`. Elsewhere `sleep` only waits and `log` writes the
 * line, so a pipe or a file gets whole lines only.
 */
export function waitIndicator(stream: ProgressStream, env: NodeJS.ProcessEnv): WaitIndicator {
  const plainSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  if (!stream.isTTY || env.CI || env.TERM === 'dumb') {
    return { sleep: plainSleep, log: (line) => void stream.write(line + '\n'), clear: () => {} };
  }
  let since = Date.now();
  let drawn = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const clear = () => {
    if (drawn) stream.write(ERASE);
    drawn = false;
  };
  let frame = 0;
  const draw = () => {
    stream.write(`${ERASE}${FRAMES[frame++ % FRAMES.length]} ${clock(Date.now() - since)}`);
    drawn = true;
  };
  return {
    async sleep(ms) {
      draw();
      timer = setInterval(draw, FRAME_MS);
      // Never keeps oak running by itself.
      timer.unref?.();
      try {
        await plainSleep(ms);
      } finally {
        stop();
        clear();
      }
    },
    log(line) {
      clear();
      stream.write(line + '\n');
      since = Date.now();
    },
    clear() {
      stop();
      clear();
    },
  };
}
