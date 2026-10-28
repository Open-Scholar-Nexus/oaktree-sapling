/**
 * The data oak owns, as zod schemas: the `oaktree-sapling` key in a paper's `project.options`,
 * `journal.yml`, `registry/papers.yml` and `pins.yml`. The rest of the myst config is myst's to
 * check (through loadConfig) [R185]. Unknown keys are ignored (`.loose()`), so a newer journal
 * field cannot break a paper pinned to an older oak [R197]. `oak validate`,
 * compose and the JSON Schema export (`toJsonSchemas`) all use these.
 */
import * as msg from './messages.js';
import { z } from 'zod';

/* --------------------------------------------------------------------------
 * 1. The engine coordinate: project.options["oaktree-sapling"]
 * ------------------------------------------------------------------------ */

/** An edition id. It names a file (`editions/<id>.yml`), so it may not carry a path [R141]. A
 *  fork pull request controls it. */
export const EDITION_ID = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be a plain name (letters, digits, . _ -)');

/** `owner/name` with GitHub's characters and lengths. The name is never `.` or `..`, so it is
 *  safe as a path segment. */
export const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

const GITHUB_URL =
  /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/;

/** `owner/name` from a github.com remote or page URL (`https://github.com/`,
 *  `ssh://git@github.com/` or `git@github.com:`), or null. A URL carrying credentials is null. */
export function repoFromGithubUrl(url: string): string | null {
  const m = GITHUB_URL.exec(url);
  return m && GITHUB_REPO.test(m[1]!) ? m[1]! : null;
}

/** An oak version a paper or a flag can name: a release `vX.Y.Z` or a dev release `vX.Y.Z-dev.N`
 *  (RELEASING.md). It becomes a clone ref, a cache path and a `$GITHUB_OUTPUT` line. The engine
 *  action, `conformance.yml` and `scripts/cut-engine-release.sh` keep shell copies, and
 *  `npm-publish.yml` one of {@link isStableEngineVersion}, held to these by `version rule parity`
 *  in `test/frozen-guards.test.ts`. */
export const ENGINE_VERSION = /^v([0-9]+)\.([0-9]+)\.([0-9]+)(?:-dev\.([0-9]+))?$/;

/** An {@link ENGINE_VERSION} without `-dev.N`: what `releases/latest` and npm carry. */
export function isStableEngineVersion(tag: string): boolean {
  return ENGINE_VERSION.test(tag) && !tag.includes('-');
}

/** The order of two {@link ENGINE_VERSION}s (negative, 0, positive), a dev release before its
 *  release, or null when either is not one. The engine action's `ref` step orders the same way. */
export function compareEngineVersions(a: string, b: string): number | null {
  const ka = engineVersionKey(a);
  const kb = engineVersionKey(b);
  if (!ka || !kb) return null;
  for (let i = 0; i < ka.length; i++) {
    const d = ka[i]! - kb[i]!;
    if (d) return d;
  }
  return 0;
}

/** `vX.Y.Z-dev.N` as [X, Y, Z, 0, N] and `vX.Y.Z` as [X, Y, Z, 1, 0]. */
function engineVersionKey(v: string): number[] | null {
  const m = ENGINE_VERSION.exec(v);
  if (!m) return null;
  const [x, y, z] = m.slice(1, 4).map(Number) as [number, number, number];
  return m[4] === undefined ? [x, y, z, 1, 0] : [x, y, z, 0, Number(m[4])];
}

/** A paper's published version: a tag `vMAJOR.MINOR.PATCH`, deposited on Zenodo as
 *  `MAJOR.MINOR.PATCH`. */
export const PAPER_VERSION_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * The GitHub Pages URL of `owner/name`: `https://<owner>.github.io/<name>/`, or the root for a
 * repo named `<owner>.github.io`, which Pages serves as the account's own site. Pages hosts are
 * lowercase. `plugins/gallery.mjs` keeps a copy, held to this one by `Pages URL parity` in
 * `test/gallery.test.ts`.
 */
export function pagesUrl(repo: string): string {
  const [owner, name] = repo.split('/');
  const host = `${owner!.toLowerCase()}.github.io`;
  return name!.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}

/** A full git commit id, SHA-1 or SHA-256. */
export const COMMIT_ID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The paths in a paper repo that need an editor's review to change [R92], written as in
 * `CODEOWNERS` without the leading `/`; a trailing `/` is a folder and a `*` one path segment,
 * for each co-located paper's environment. `templates/paper/CODEOWNERS` keeps a copy, held to
 * this one by `editor paths parity` in `test/checks.test.ts`.
 */
export const GATED_PATHS = [
  '.github/',
  'CODEOWNERS',
  'paper-environment.yml',
  'papers/*/paper-environment.yml',
  'node_modules/',
  '.engine/',
] as const;

/** The {@link GATED_PATHS} oak ships and resets, all but `paper-environment.yml`, which is the
 *  author's. */
export const ENGINE_MANAGED_PATHS = ['.github/', 'CODEOWNERS'] as const;

/** Whether the repo-relative `path` is one of `paths`, or inside one of their folders. A `*`
 *  in a path matches one segment. */
export function underPaths(paths: readonly string[], path: string): boolean {
  const p = path.replace(/^(\.?\/)+/, '');
  return paths.some((g) => {
    if (!g.includes('*')) {
      return g.endsWith('/') ? p === g.slice(0, -1) || p.startsWith(g) : p === g;
    }
    const segment = g
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+');
    return new RegExp(`^${segment}${g.endsWith('/') ? '' : '$'}`).test(p);
  });
}

/** A Zenodo DOI as Zenodo mints it: `10.5281/zenodo.<id>`, or `10.5072/zenodo.<id>` on the
 *  sandbox. */
const ZENODO_DOI = /^10\.(5281|5072)\/zenodo\.([0-9]+)$/;

/** The DOI prefix Zenodo, or its sandbox, gives a record id. */
export function zenodoDoiPrefix(sandbox: boolean): string {
  return sandbox ? '10.5072/zenodo.' : '10.5281/zenodo.';
}

/** The record id and environment of a {@link ZENODO_DOI}, else null. */
export function parseZenodoDoi(doi: string): { sandbox: boolean; recordId: string } | null {
  const m = ZENODO_DOI.exec(doi);
  return m ? { sandbox: m[1] === '5072', recordId: m[2]! } : null;
}

/**
 * The journal checkout a build composed from, which the deposit archives as `journal.zip`
 * [R66]. oak writes it into `myst.oak.yml`; a value in the author's `myst.yml` is dropped.
 * Absent for a `--no-instance` build. `repo: "."` is a paper repo that is its own journal, so
 * `source.zip` holds it. `repo` is null for a clone with no GitHub origin, and `commit` is null
 * when the files are not a commit of their own repo (local changes, a folder inside a larger
 * repo, or not a git checkout).
 */
export const JournalStamp = z.union([
  z.object({ repo: z.literal('.') }).strict(),
  z
    .object({
      repo: z.string().regex(GITHUB_REPO).nullable(),
      commit: z.string().regex(COMMIT_ID).nullable(),
    })
    .strict(),
]);
export type JournalStamp = z.infer<typeof JournalStamp>;

/**
 * The key under myst's `project.options`. It sits beside keys a paper already uses (such as
 * `options.youtube`), which are left alone. `.loose()` accepts keys from a newer oak [design §6].
 */
export const OaktreeSaplingOptions = z
  .object({
    /** An {@link ENGINE_VERSION}, at or above pins.yml's `min_engine_version`. The engine
     *  action's `ref` step refuses anything else [R41]. */
    version: z.string().regex(ENGINE_VERSION, 'must be a release tag like v1.2.3 or v1.2.3-dev.4'),
    /** Selects `editions/<edition>.yml` [R195]. */
    edition: EDITION_ID,
    /** Written by oak into `myst.oak.yml` only ({@link JournalStamp}). */
    journal: JournalStamp.optional(),
  })
  .loose();
export type OaktreeSaplingOptions = z.infer<typeof OaktreeSaplingOptions>;

/** Parses the key out of `project.options` without touching its siblings. Throws when it is
 *  missing or invalid. */
export function readEngineOptions(
  projectOptions: Record<string, unknown> | undefined,
): OaktreeSaplingOptions {
  const raw = projectOptions?.['oaktree-sapling'];
  if (raw === undefined) {
    throw new Error(msg.build.coordinateMissingFromResolved);
  }
  return OaktreeSaplingOptions.parse(raw);
}

/* --------------------------------------------------------------------------
 * 2. journal.yml: the instance manifest (engine-owned, additive-only)
 * ------------------------------------------------------------------------ */

export const PreviewConfig = z
  .object({
    /** 'artifact' links the build artifact instead, for a journal without Cloudflare secrets
     *  [R6]. */
    provider: z.enum(['cloudflare', 'artifact']).default('artifact'),
    cf_project_name: z.string().optional(),
    /** Preview branch naming; `{repo}` / `{pr}` placeholders ([R27]). */
    branch_pattern: z.string().default('paper-{repo}-{pr}'),
  })
  .loose();
export type PreviewConfig = z.infer<typeof PreviewConfig>;

export const ZenodoConfig = z
  .object({
    /** Optional Zenodo community identifier; a new journal has none [R19]. */
    community: z.string().optional(),
    /** Optional paragraph appended to every deposit's description [R19]. */
    description_blurb: z.string().optional(),
  })
  .loose();
export type ZenodoConfig = z.infer<typeof ZenodoConfig>;

/**
 * An editorial check the journal turns on, by id, with its options. It lives in the journal
 * repo, which authors cannot change. `optional: true` reports without blocking a merge.
 */
export const Check = z
  .object({
    id: z.string().min(1),
    optional: z.boolean().optional(),
  })
  .loose();
export type Check = z.infer<typeof Check>;

export const JournalConfig = z
  .object({
    name: z.string().min(1),
    url: z.string().optional(),
    /** Only 'paper' is built. The field exists so a journal-level instance is detected, not
     *  assumed [design §9]. */
    tier: z.enum(['paper', 'edition', 'journal']).default('paper'),
    /** The template's placeholder `id:`, which `oak validate` rejects on a real paper. Set per
     *  journal. */
    id_sentinel: z.string().optional(),
    /** Anchored regex a paper `id:` must match [R7]. */
    id_pattern: z.string().optional(),
    /** The journal's typst template [R76]: a name, a path (only a `./` or `../` value, relative
     *  to the journal repo) or a URL. The author's own template outranks it, with a
     *  warning; oak's is the default. */
    typst_template: z.string().optional(),
    preview: PreviewConfig.prefault({}),
    zenodo: ZenodoConfig.prefault({}),
    /** The editorial checks `oak validate` runs. */
    checks: z.array(Check).default([]),
  })
  .loose();
export type JournalConfig = z.infer<typeof JournalConfig>;

/* --------------------------------------------------------------------------
 * 3. registry/papers.yml: the paper registry
 *
 * Two coordinates:
 *   - id       → the deposit and dedup key, myst's project.id [R7]
 *   - location → where the paper lives, read by {@link parseLocation} [design §9]
 * An entry may carry `slug`, `edition` and `doi`; nothing reads them. The website reads the
 * edition and the DOI from the paper's own `myst.yml`.
 * ------------------------------------------------------------------------ */

/** What {@link parseLocation} returns: a GitHub repository with the paper at its root, or a
 *  folder in the journal repo, relative to its root. */
export type PaperLocation = { repo: string } | { path: string };

/**
 * Reads a registry `location`, or returns null. `owner/name` is a GitHub repository; a `./` or
 * `../` value is a folder in the journal repo, the prefix rule `typst_template` uses [R76].
 * `plugins/gallery.mjs` keeps a copy, held to this one by `location rule parity` in
 * `test/gallery.test.ts`.
 */
export function parseLocation(value: unknown): PaperLocation | null {
  if (typeof value !== 'string') return null;
  if (/^\.\.?\//.test(value)) return { path: value };
  if (GITHUB_REPO.test(value)) return { repo: value };
  return null;
}

/** The repository of a `location`, or null for a folder in the journal repo or a bad value. */
export function locationRepo(value: unknown): string | null {
  const location = parseLocation(value);
  return location && 'repo' in location ? location.repo : null;
}

/** GitHub repository names compare case-insensitively. */
export function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export const RegistryEntry = z
  .object({
    id: z.string().min(1),
    location: z.string().refine((v) => parseLocation(v) !== null),
    slug: z.string().min(1).optional(),
    edition: EDITION_ID.optional(),
    doi: z.string().optional(),
    /**
     * Where the paper is published, when that is not its GitHub Pages URL ({@link pagesUrl}),
     * which the gallery otherwise derives from the location. Display data such as the title is
     * still fetched from the paper, never stored here [R197].
     */
    site_url: z.string().optional(),
  })
  .loose();
export type RegistryEntry = z.infer<typeof RegistryEntry>;

export const Registry = z.array(RegistryEntry);
export type Registry = z.infer<typeof Registry>;

/* --------------------------------------------------------------------------
 * 4. pins.yml: the repos oak and the journal come from [R194]
 * Read by both the engine action and local `oak`.
 * ------------------------------------------------------------------------ */

export const Pins = z
  .object({
    /** owner/repo the engine is checked out from; only the *ref* floats. */
    engine_repo: z.string().min(1),
    /** owner/repo of the journal; '.' in a co-located repository, which holds its own. Absent,
     *  the journal is unknown. */
    instance_repo: z.string().optional(),
    /** The engine a co-located repository's jobs with no paper of their own run. */
    engine_version: z.string().optional(),
  })
  .loose();
export type Pins = z.infer<typeof Pins>;

/* --------------------------------------------------------------------------
 * 5. Paper-id checks [R193]
 * ------------------------------------------------------------------------ */

export type IdCheckResult =
  { ok: true } | { ok: false; severity: 'error' | 'warn'; message: string };

/** The id oak's own paper template ships. It is always rejected: a journal's `id_sentinel` adds
 *  to it and cannot turn it off [R119]. A test keeps it in step with `templates/paper/myst.yml`. */
export const ENGINE_ID_SENTINEL = 'CHANGE-ME-template-placeholder';

/**
 * Check A: the placeholder id and the id pattern. Needs only the paper's id and the journal's
 * settings, and fails everywhere [R12].
 */
export function checkIdShape(
  id: string,
  policy: { id_sentinel?: string; id_pattern?: string },
): IdCheckResult {
  if (id === ENGINE_ID_SENTINEL || (policy.id_sentinel && id === policy.id_sentinel)) {
    return {
      ok: false,
      severity: 'error',
      message: msg.validate.idPlaceholder(id),
    };
  }
  if (policy.id_pattern) {
    const re = new RegExp(policy.id_pattern);
    if (!re.test(id)) {
      return {
        ok: false,
        severity: 'error',
        message: msg.validate.idPatternMismatch(id, policy.id_pattern),
      };
    }
  }
  return { ok: true };
}

/**
 * Check B: the id is unique in the registry. Fails when the registry is present, and only warns
 * without one, as in a bare local validate [R193]. `self` excludes the paper's own entries: those
 * whose location is `self.repo`, and the entries in `self.own`.
 */
export function checkIdUniqueness(
  id: string,
  registry: Registry | null,
  self?: { repo?: string; own?: readonly RegistryEntry[] },
  opts: { selfIdentifiable?: boolean } = {},
): IdCheckResult {
  if (registry === null) {
    return {
      ok: false,
      severity: 'warn',
      message: msg.validate.idRegistryUnavailable(id),
    };
  }
  const isSelf = (e: RegistryEntry) => {
    if (self?.own?.includes(e)) return true;
    const repo = locationRepo(e.location);
    return !!self?.repo && !!repo && sameRepo(repo, self.repo);
  };
  const clash = registry.find((e) => e.id === id && !isSelf(e));
  if (clash) {
    // Without the repo (no GITHUB_REPOSITORY, a checkout with no matching origin) the
    // paper's own entry cannot be told from a duplicate, so this only warns. CI always sets it.
    if (opts.selfIdentifiable === false) {
      return {
        ok: false,
        severity: 'warn',
        message: msg.validate.idMaybeOwnEntry(id, clash.location),
      };
    }
    return {
      ok: false,
      severity: 'error',
      message: msg.validate.idTaken(id, clash.location),
    };
  }
  return { ok: true };
}

/** Check C: the paper's own registry entries carry its id, so check B tests the id the paper
 *  has. `own` holds the entries whose location is the paper's repo or folder. */
export function checkOwnEntryId(id: string, own: RegistryEntry[]): IdCheckResult {
  const stale = own.find((e) => e.id !== id);
  if (!stale) return { ok: true };
  return {
    ok: false,
    severity: 'error',
    message: msg.validate.idRegistryMismatch(stale.id, id),
  };
}

/** An entry {@link readRegistry} skipped: its id, or its position from 1, and why. */
export type SkippedEntry = { label: string; reason: 'location' | 'other'; hint?: string };

/**
 * Splits a parsed `registry/papers.yml` into its valid entries and the ones it skips, so one bad
 * entry does not stop every paper's checks. Returns null when the file is not a list. An entry
 * in the `{ repo, path: . }` form gets the string to write as its `hint`.
 */
export function readRegistry(raw: unknown): { entries: Registry; skipped: SkippedEntry[] } | null {
  const list = raw ?? [];
  if (!Array.isArray(list)) return null;
  const entries: Registry = [];
  const skipped: SkippedEntry[] = [];
  list.forEach((value: unknown, i) => {
    const parsed = RegistryEntry.safeParse(value);
    if (parsed.success) {
      entries.push(parsed.data);
      return;
    }
    const obj = (value ?? {}) as Record<string, unknown>;
    const label = typeof obj.id === 'string' && obj.id ? obj.id : `#${i + 1}`;
    if (parseLocation(obj.location) === null) {
      const old = (obj.location ?? {}) as Record<string, unknown>;
      const atRoot = old.path === undefined || old.path === '.';
      const hint = atRoot ? locationRepo(old.repo) : null;
      skipped.push({ label, reason: 'location', ...(hint ? { hint } : {}) });
    } else {
      skipped.push({ label, reason: 'other' });
    }
  });
  return { entries, skipped };
}

/* --------------------------------------------------------------------------
 * 6. JSON Schema export, for editor autocomplete
 * ------------------------------------------------------------------------ */

export function toJsonSchemas() {
  return {
    oaktreeSaplingOptions: z.toJSONSchema(OaktreeSaplingOptions),
    journal: z.toJSONSchema(JournalConfig),
    registry: z.toJSONSchema(Registry),
    pins: z.toJSONSchema(Pins),
  };
}
