/**
 * progress.ts: what `oak release` prints. Each step that happened is a line starting with the
 * time; while oak waits, a terminal shows one line with a spinner and what it waits for, which
 * rewrites itself and is erased before the next step; the last block says what is left to do.
 *
 * The spinner is drawn only while oak waits and erased before the wait ends, so the gh calls
 * between waits (gh.ts `showWorking`) and every step start on a clear line.
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
  /** Writes `line` on a line of its own, after the time ({@link stamp}). */
  log(line: string): void;
  /** Sets what oak waits for. A terminal shows it after the spinner; elsewhere a change is
   *  logged. */
  status(text: string): void;
  /** Waits for `work`, drawing the spinner meanwhile; it is erased when this resolves. */
  during<T>(work: Promise<T>): Promise<T>;
  /** Waits `ms`, as {@link WaitIndicator.during}. */
  sleep(ms: number): Promise<void>;
  /** Writes a blank line, then `lines`, with no time. */
  next(lines: string[]): void;
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
 * spinner is drawn on a terminal outside CI, as gh.ts `showWorking`; elsewhere a wait only
 * waits, so a pipe or a file gets whole lines only.
 */
export function waitIndicator(
  stream: ProgressStream,
  env: NodeJS.ProcessEnv,
  now: () => Date = () => new Date(),
): WaitIndicator {
  const plainSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  const write = (line: string) => void stream.write(stamp(now()) + line + '\n');
  const spins = Boolean(stream.isTTY) && !env.CI && env.TERM !== 'dumb';
  let text = '';
  let drawn = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  const draw = () => {
    stream.write(`${ERASE}${FRAMES[frame++ % FRAMES.length]}${text ? ` ${text}` : ''}`);
    drawn = true;
  };
  const clear = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (drawn) stream.write(ERASE);
    drawn = false;
  };
  const during = async <T>(work: Promise<T>): Promise<T> => {
    if (!spins) return work;
    draw();
    timer = setInterval(draw, FRAME_MS);
    // Never keeps oak running by itself.
    timer.unref?.();
    try {
      return await work;
    } finally {
      clear();
    }
  };
  return {
    log(line) {
      clear();
      write(line);
    },
    status(next) {
      if (next === text) return;
      text = next;
      if (!spins) write(next);
      else if (drawn) draw();
    },
    during,
    sleep: (ms) => during(plainSleep(ms)),
    next(lines) {
      clear();
      stream.write('\n' + lines.join('\n') + '\n');
    },
    clear,
  };
}
