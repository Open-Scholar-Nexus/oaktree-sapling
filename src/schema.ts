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

/**
 * The key under myst's `project.options`. It sits beside keys a paper already uses (such as
 * `options.youtube`), which are left alone. `.loose()` accepts keys from a newer oak [design §6].
 */
export const OaktreeSaplingOptions = z
  .object({
    /** A release tag (`vX.Y.Z`), the default branch, a SHA or `refs/pull/N/merge`. The last two
     *  run only from a same-repo pull request or with the maintainer override (ref.ts). */
    version: z.string().min(1),
    /** Selects `editions/<edition>.yml` [R195]. */
    edition: EDITION_ID,
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
    /** Optional Zenodo community identifier; a fresh tenant has none ([R19]). */
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
 * 3. registry/papers.yml: the paper registry (additive-only)
 *
 * Three separate coordinates:
 *   - id       → the deposit and dedup key, myst's project.id [R7]
 *   - slug     → the `/<slug>/` URL path and thumbnail location
 *   - location → {repo, path}, where the paper lives [design §9]
 * ------------------------------------------------------------------------ */

export const PaperLocation = z
  .object({
    /** owner/repo on GitHub. */
    repo: z.string().min(1),
    /** path within the repo to the paper project root; '.' for repo=paper. */
    path: z.string().default('.'),
  })
  .loose();

export const RegistryEntry = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    location: PaperLocation,
    /** Concept DOI; absent until the paper is deposited. */
    doi: z.string().optional(),
    /**
     * Where the paper is published, when that is not `https://<owner>.github.io/<name>`, which
     * the gallery otherwise derives from `location.repo`. Display data such as the title is
     * still fetched from the paper, never stored here [R197].
     */
    site_url: z.string().optional(),
    edition: EDITION_ID,
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
    /** owner/repo of instance-config; '.' or omitted when co-located (repo=journal). */
    instance_repo: z.string().default('.'),
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
 * without one, as in a bare local validate [R193]. `self` excludes the paper's own entry.
 */
export function checkIdUniqueness(
  id: string,
  registry: Registry | null,
  self?: { slug?: string },
  opts: { selfIdentifiable?: boolean } = {},
): IdCheckResult {
  if (registry === null) {
    return {
      ok: false,
      severity: 'warn',
      message: msg.validate.idRegistryUnavailable(id),
    };
  }
  const clash = registry.find((e) => e.id === id && e.slug !== self?.slug);
  if (clash) {
    // Without the repo (no GITHUB_REPOSITORY, a checkout with no matching origin) the
    // paper's own entry cannot be told from a duplicate, so this only warns. CI always sets it.
    if (opts.selfIdentifiable === false) {
      return {
        ok: false,
        severity: 'warn',
        message: msg.validate.idMaybeOwnEntry(id, clash.location.repo, clash.slug),
      };
    }
    return {
      ok: false,
      severity: 'error',
      message: msg.validate.idTaken(id, clash.location.repo, clash.slug),
    };
  }
  return { ok: true };
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
