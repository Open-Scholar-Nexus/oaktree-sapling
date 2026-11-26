/**
 * The flags each command takes, read with node's `parseArgs`. A command reads its flags from
 * {@link parse}, whose result has a field for each flag its {@link OPTIONS} entry lists, so
 * reading a flag the entry does not list fails to compile, and a flag the entry does not list
 * is refused.
 */
import { parseArgs } from 'node:util';
import * as msg from './messages.js';
import { UserError } from './messages.js';

const S = { type: 'string' } as const;
const B = { type: 'boolean' } as const;

/** Flags every command takes. */
const GLOBAL = { json: B, verbose: B, help: B } as const;

const instance = { instance: S, 'no-instance': B } as const;
const engine = { 'engine-repo': S, 'engine-version': S, owner: S } as const;
const secrets = {
  'zenodo-token': S,
  'zenodo-token-sandbox': S,
  'cf-token': S,
  'cf-account': S,
} as const;
const zenodoQuery = {
  repo: S,
  sandbox: B,
  'site-url': S,
  ...instance,
  token: S,
  paper: S,
  myst: S,
} as const;

export const OPTIONS = {
  'bootstrap journal': {
    repo: S,
    name: S,
    edition: S,
    ...engine,
    'no-require-checks': B,
    'no-site': B,
    'co-located': B,
    yes: B,
    ...secrets,
  },
  'bootstrap paper': {
    repo: S,
    ...instance,
    edition: S,
    from: S,
    'source-ref': S,
    ...engine,
    private: B,
    'no-require-checks': B,
    yes: B,
    ...secrets,
  },
  upgrade: { repo: S, paper: S, to: S, 'files-only': B, yes: B },
  validate: {
    paper: S,
    ...instance,
    'typst-template': S,
    strict: B,
    report: S,
    repo: S,
    'base-url': S,
    'no-site-template': B,
  },
  build: {
    paper: S,
    ...instance,
    'base-url': S,
    'no-site-template': B,
    'exports-only': B,
    'no-exports': B,
    'typst-template': S,
    port: S,
    'server-port': S,
    'keep-host': B,
  },
  start: {
    paper: S,
    ...instance,
    'typst-template': S,
    port: S,
    'server-port': S,
    template: S,
    headless: B,
    'keep-host': B,
    'base-url': S,
    'no-site-template': B,
  },
  release: {
    repo: S,
    sandbox: B,
    yes: B,
    'publish-without-review': B,
    ...instance,
    'site-url': S,
    token: S,
    tag: S,
    'use-local-build': B,
  },
  'release status': zenodoQuery,
  'release reserve-doi': zenodoQuery,
  'release deposit': {
    tag: S,
    paper: S,
    myst: S,
    'use-local-build': B,
    'publish-without-review': B,
    token: S,
    'site-url': S,
    'bundle-out': S,
    ...instance,
    repo: S,
  },
  clean: { cache: B, yes: B },
  'post-checks': { report: S, repo: S, sha: S, base: S, 'verified-head': S, paper: S },
  'deploy-preview': { 'verified-head': S, ...instance, repo: S, paper: S },
  'conformance reset': { repo: S },
  'conformance run': { repo: S, tag: S, 'fork-repo': S, 'run-id': S, record: S },
} as const;

export type Command = keyof typeof OPTIONS;

type Options = Record<string, { readonly type: 'string' | 'boolean' }>;
type Values<O> = {
  readonly [K in keyof O]?: O[K] extends { type: 'string' } ? string : boolean;
};
/** The flags of `oak <command>`, as {@link parse} returns them. */
export type Args<C extends Command> = Values<(typeof OPTIONS)[C] & typeof GLOBAL>;

/**
 * Reads `argv` as `oak <command>` takes it, with up to `words` arguments that are not flags.
 * Refuses a flag the command does not take, a flag with no value (last, or followed by another
 * flag: callers read `a.repo ?? process.env.X`, so a missing value must not fall through to the
 * environment), and extra words. An empty value is kept: `--base-url ""` serves at the root.
 */
export function parse<C extends Command>(
  command: C,
  argv: readonly string[],
  words = 0,
): { values: Args<C>; positionals: string[] } {
  const options: Options = { ...OPTIONS[command], ...GLOBAL };
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (e) {
    throw refusal(command, options, e);
  }
  const { values, positionals } = parsed;
  if (positionals.length > words) {
    throw new UserError(msg.unknownArg(command, positionals[words]!, null));
  }
  return { values: values as Args<C>, positionals };
}

/** The flags of `command` that take a value. */
export function valueFlags(command: Command): string[] {
  const options: Options = OPTIONS[command];
  return Object.keys(options).filter((name) => options[name]!.type === 'string');
}

/** `parseArgs`'s error as oak words it, or the error itself when it is not one of those. */
function refusal(command: Command, options: Options, e: unknown): unknown {
  const code = (e as { code?: unknown }).code;
  // The flag is the first quoted word of node's message, as in `Unknown option '--sanbox'`.
  const arg = /'(-[^' ]*)/.exec(String((e as Error).message))?.[1];
  if (!arg || typeof code !== 'string') return e;
  const name = arg.replace(/^-+/, '');
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    return new UserError(
      options[name]?.type === 'string' ? msg.flagNeedsValue(name) : msg.flagTakesNoValue(name),
    );
  }
  if (code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return e;
  const runsNotebooks = command === 'build' || command === 'start' || command === 'validate';
  if (runsNotebooks && (name === 'execute' || name === 'execute-parallel')) {
    return new UserError(msg.noExecute(command));
  }
  const near = nearest(name, Object.keys(options));
  return new UserError(msg.unknownArg(command, arg, near && `--${near}`));
}

/** Levenshtein distance: only ever run over two short words. */
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
