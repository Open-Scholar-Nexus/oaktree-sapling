/**
 * progress.ts: the lines `oak release` logs, each starting with the time, and the spinner it shows
 * on a terminal while it waits for the Deposit version run.
 *
 * The spinner is drawn only during a sleep and erased before the sleep resolves, so the gh calls
 * between sleeps (gh.ts `showWorking`) and every logged line start on a clear line.
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
  /** Waits `ms`, drawing the spinner meanwhile; it is erased when this resolves. */
  sleep(ms: number): Promise<void>;
  /** Writes `line` on a line of its own, after the time ({@link stamp}). */
  log(line: string): void;
  /** Erases the spinner if it is drawn, before something else writes to the stream. */
  clear(): void;
}

/** `[HH:MM:SS] ` in local time, 24-hour, the same in every locale. */
export function stamp(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `[${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}] `;
}

/**
 * A {@link WaitIndicator} on `stream`. Each logged line starts with the time `now` gives. The
 * spinner is drawn on a terminal outside CI, as gh.ts `showWorking`; elsewhere `sleep` only
 * waits, so a pipe or a file gets whole lines only.
 */
export function waitIndicator(
  stream: ProgressStream,
  env: NodeJS.ProcessEnv,
  now: () => Date = () => new Date(),
): WaitIndicator {
  const plainSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  const write = (line: string) => void stream.write(stamp(now()) + line + '\n');
  if (!stream.isTTY || env.CI || env.TERM === 'dumb') {
    return { sleep: plainSleep, log: write, clear: () => {} };
  }
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
    stream.write(`${ERASE}${FRAMES[frame++ % FRAMES.length]}`);
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
      write(line);
    },
    clear() {
      stop();
      clear();
    },
  };
}
