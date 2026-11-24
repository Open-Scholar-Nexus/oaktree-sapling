/**
 * A command's arguments, read against its table in commands.ts. The table is the one list of the
 * flags a command takes: {@link parseArgs} refuses any other, the usage text (messages.ts) is
 * printed from it, and {@link Args} only reads a flag the table names, so reading an unlisted one
 * fails to compile.
 */
import * as msg from './messages.js';
import { UserError } from './messages.js';

/** A flag. `value` is the placeholder the usage shows for a flag that takes a value. */
export interface FlagSpec {
  readonly name: string;
  readonly value?: string;
  /** Shown under the command in the usage. */
  readonly help?: string;
  /** Shown without brackets in the usage; the command checks it is there. */
  readonly required?: boolean;
  /** Left out of the usage: passed by the workflows or by another oak command, or accepted
   *  only to be refused with a sentence of its own. */
  readonly hidden?: boolean;
}

/** A list is alternatives, shown as `[--a | --b]`. */
export type FlagEntry = FlagSpec | readonly FlagSpec[];

export interface CommandSpec {
  /** The words after `oak`, such as `release deposit`. */
  readonly name: string;
  /** The words a command takes that are not flags, as the usage shows them, such as `<site>`. */
  readonly positionals?: readonly string[];
  readonly flags: readonly FlagEntry[];
  /** What it does, in the usage. */
  readonly summary: string;
}

/** Flags every command takes. */
export const GLOBAL_FLAGS = ['json', 'verbose', 'help'] as const;

type EntryNames<E> = E extends readonly FlagSpec[]
  ? E[number]['name']
  : E extends FlagSpec
    ? E['name']
    : never;
/** The names of the flags a command's table lists, and the global ones. */
export type FlagsOf<C extends CommandSpec> =
  EntryNames<C['flags'][number]> | (typeof GLOBAL_FLAGS)[number];

/**
 * A command's parsed arguments. A helper declares the flags it reads as `Args<'a' | 'b'>`, and
 * accepts the arguments of any command whose table lists them.
 */
export interface Args<N extends string> {
  /** The value after `--name`, or undefined when absent. An empty value is returned as it is:
   *  some flags mean something by it (`--base-url ""` serves at the root). */
  readonly value: (name: N) => string | undefined;
  readonly has: (name: N) => boolean;
  /** The words that are not flags or their values, in order. */
  readonly positionals: readonly string[];
  /** The arguments as given, for a child process. */
  readonly argv: readonly string[];
}

const flagsOf = (spec: CommandSpec): FlagSpec[] => spec.flags.flat() as FlagSpec[];

/** The flags that take a value, for finding the first word that is not one. */
export function valueFlags(spec: CommandSpec): string[] {
  return flagsOf(spec)
    .filter((f) => f.value)
    .map((f) => f.name);
}

/**
 * Reads `argv` against `spec`. Refuses a flag it does not list, a flag with no value (last, or
 * followed by another `--flag`: callers read `value(...) ?? process.env.X`, so a missing value
 * must not fall through to the environment), and more words than `spec.positionals`.
 */
export function parseArgs<C extends CommandSpec>(
  spec: C,
  argv: readonly string[],
): Args<FlagsOf<C>> {
  const known = new Map(flagsOf(spec).map((f) => [f.name, f]));
  for (const g of GLOBAL_FLAGS) known.set(g, { name: g });
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const f = known.get(name);
    if (!f) {
      if (name === 'execute' || name === 'execute-parallel') {
        throw new UserError(msg.noExecute(spec.name));
      }
      const near = nearest(name, [...known.keys()]);
      throw new UserError(msg.unknownArg(spec.name, arg, near && `--${near}`));
    }
    if (!f.value) {
      switches.add(name);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UserError(msg.flagNeedsValue(name));
    if (!values.has(name)) values.set(name, v);
    i++;
  }
  const allowed = spec.positionals?.length ?? 0;
  if (positionals.length > allowed) {
    throw new UserError(msg.unknownArg(spec.name, positionals[allowed]!, null));
  }
  return {
    value: (name) => values.get(name),
    has: (name) => switches.has(name),
    positionals,
    argv,
  };
}

/** The number of single-character edits between `a` and `b`. */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** The closest of `candidates` to a typo, or null when nothing is close enough to suggest. */
export function nearest(word: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const v of candidates) {
    const d = editDistance(word.toLowerCase(), v);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return bestD <= 3 ? best : null;
}
