/**
 * `oak deploy-preview` [R26]. Missing secrets, a Cloudflare outage or a bad journal.yml all fall
 * back to a comment linking the build artifact; the run fails only when the pull request check
 * refuses or a gh call fails. It is Stage 2: it runs in the trusted `workflow_run` job, which can
 * write to the pull request, and acts on what Stage 1 built. Cloudflare and gh are injected; the
 * real ones are in gh.ts.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJournalConfig } from './yaml-io.js';
import * as msg from './messages.js';
import { annotate, firstLine, stickyMarker } from './messages.js';
import { JournalConfig, type PreviewConfig } from './schema.js';
import { resolvePaperDir, takePaperDir, takePrNumber, verifyPrHead } from './artifact.js';
import { ok, type Outcome } from './result.js';

/* --------------------------------------------------------------------------
 * Injected; the real ones are in gh.ts
 * ------------------------------------------------------------------------ */

export interface PagesDeployer {
  /** Deploys a built site to Cloudflare Pages; resolves the deployment URL. */
  deploy(opts: {
    dir: string;
    accountId: string;
    apiToken: string;
    projectName: string;
    branch: string;
  }): Promise<string>;
}

export interface GhPr {
  /** Creates or updates a sticky comment, keyed by `header`, on a pull request. */
  sticky(repoRoot: string, prNumber: string, header: string, body: string): void;
  /** The head commit of pull request `pr`, for {@link verifyPrHead}. */
  prHead(repo: string, pr: string): string;
}

/* --------------------------------------------------------------------------
 * Sticky comment headers and labels. Do not rename: GitHub stores them
 * ------------------------------------------------------------------------ */

export const STICKY_PREVIEW = 'oak-preview';
/** The label `openFailureIssue` uses; defined here so `oak bootstrap` can create it. */
export const LABEL_ZENODO_FAILED = 'zenodo-publish-failed';

/* --------------------------------------------------------------------------
 * journal.yml `preview:` settings, read as loadJournalZenodo reads `zenodo:`
 * ------------------------------------------------------------------------ */

/** Reads `preview:` from `<instanceRoot>/journal.yml`, with the schema defaults when absent. A
 *  file that fails to parse is the journal's mistake, so it falls back and `problem` says why
 *  in the comment. */
export function loadJournalPreview(instanceRoot: string | null): {
  preview: PreviewConfig;
  problem?: string;
} {
  const empty = () => ({ preview: JournalConfig.parse({ name: 'x' }).preview });
  if (!instanceRoot) return empty();
  try {
    const journal = readJournalConfig(instanceRoot);
    return journal ? { preview: journal.preview } : empty();
  } catch (e) {
    return { ...empty(), problem: msg.workflow.previewBadJournal(firstLine(e)) };
  }
}

/* --------------------------------------------------------------------------
 * Pure logic
 * ------------------------------------------------------------------------ */

/** Files Cloudflare Pages acts on in the deploy root: `_worker.js`, `_middleware.js` and
 *  `functions/` run as code, `_redirects`, `_headers` and `_routes.json` rewrite responses. A fork
 *  controls the artifact, so they are removed before a deploy ([R154]). */
const PAGES_CONTROL_FILES = [
  '_worker.js',
  'functions',
  '_routes.json',
  '_redirects',
  '_headers',
  '_middleware.js',
];

/** Removes Pages control files from the deploy root; returns the names removed ([R154]). */
export function stripPagesControlFiles(siteDir: string): string[] {
  const removed: string[] = [];
  for (const name of PAGES_CONTROL_FILES) {
    const p = join(siteDir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

const BRANCH_MAX = 28;
const slug = (x: string): string =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Expands `{repo}` and `{pr}` into a Cloudflare Pages branch alias (lowercase `[a-z0-9-]`, at
 *  most 28 characters). `{repo}` takes the remaining length last, so a long name never cuts off
 *  `{pr}`, and a truncated name is hashed so papers sharing one Pages project stay distinct. */
export function previewBranch(pattern: string, repo: string, pr: string): string {
  const shortRepo = repo.includes('/') ? repo.slice(repo.indexOf('/') + 1) : repo;
  const withPr = pattern.replaceAll('{pr}', pr);
  const fixed = slug(withPr.replaceAll('{repo}', ''));
  const full = slug(shortRepo);
  let name = full;
  if (fixed.length + full.length > BRANCH_MAX) {
    const digest = createHash('sha256').update(full).digest('hex').slice(0, 4);
    const room = BRANCH_MAX - fixed.length - (digest.length + 1);
    name = room > 0 ? `${slug(full.slice(0, room))}-${digest}` : digest;
  }
  return slug(withPr.replaceAll('{repo}', name)).slice(0, BRANCH_MAX).replace(/-+$/g, '');
}

export type PreviewPlan =
  | { mode: 'cloudflare'; accountId: string; apiToken: string; projectName: string; branch: string }
  | { mode: 'artifact'; reason: string };

/** A Cloudflare deploy when `provider: cloudflare`, both secrets and a `cf_project_name` are
 *  set, else an artifact link with the reason. */
export function planPreview(input: {
  preview: PreviewConfig;
  cf: { apiToken?: string; accountId?: string };
  repo: string;
  pr: string;
}): PreviewPlan {
  const { preview, cf, repo, pr } = input;
  if (preview.provider !== 'cloudflare') {
    return { mode: 'artifact', reason: msg.workflow.previewProviderIsNot(preview.provider) };
  }
  if (!cf.apiToken || !cf.accountId) {
    return { mode: 'artifact', reason: msg.workflow.previewNoCloudflareSecrets };
  }
  if (!preview.cf_project_name) {
    return { mode: 'artifact', reason: msg.workflow.previewNoProjectName };
  }
  return {
    mode: 'cloudflare',
    accountId: cf.accountId,
    apiToken: cf.apiToken,
    projectName: preview.cf_project_name,
    branch: previewBranch(preview.branch_pattern, repo, pr),
  };
}

export function previewComment(url: string): string {
  return [stickyMarker(STICKY_PREVIEW), msg.pr.previewDeployed(url)].join('\n');
}

export function artifactComment(runUrl: string, reason: string): string {
  return [stickyMarker(STICKY_PREVIEW), msg.pr.previewArtifact(runUrl, reason)].join('\n');
}

/* --------------------------------------------------------------------------
 * Orchestration
 * ------------------------------------------------------------------------ */

export interface DeployPreviewInput {
  siteDir: string;
  /** The default branch's checkout. */
  repoRoot: string;
  /** The journal repo; null without one, or why it could not be found, and the preview then
   *  falls back as for a bad journal.yml. */
  instanceRoot: string | null | { problem: string };
  /** GITHUB_REPOSITORY and GITHUB_SERVER_URL, for the fallback link and labels. */
  repo: string | null;
  serverUrl: string;
  /** The Build paper run holding the build artifact (`workflow_run.id`), so the fallback comment
   *  links to that run. */
  artifactRunId?: string;
  cf: { apiToken?: string; accountId?: string };
  /** The commit Stage 1 built: `--verified-head`, else the `workflow_run` event's. */
  verifiedHead?: string;
  /** `--paper`, checked against the artifact's `.paper` ({@link resolvePaperDir}). */
  paper?: string;
}

export interface PreviewDeps {
  deployer: PagesDeployer;
  gh: GhPr;
}

/** `oak deploy-preview <site>`: deploys the build artifact to a preview URL, or falls
 *  back to a link to it, and comments on the pull request. Without a pull request it does
 *  nothing. It fails only when the pull request check refuses ({@link verifyPrHead}).
 *  Documented at DOCS.deployPreview. */
export async function cmdDeployPreview(
  input: DeployPreviewInput,
  deps: PreviewDeps,
): Promise<Outcome> {
  const { siteDir, repoRoot, instanceRoot, repo, serverUrl, cf } = input;
  // The `.pr-number` and `.paper` files leave the site before anything else, so neither is served.
  const pr = takePrNumber(siteDir);
  const paper = resolvePaperDir(input.paper, takePaperDir(siteDir));
  if (!pr) {
    process.stderr.write(msg.workflow.noPrNumber + '\n');
    return ok({ preview: 'skipped', reason: msg.workflow.previewNoPrNumberReason });
  }
  verifyPrHead(repo, pr, input.verifiedHead, (r, n) => deps.gh.prHead(r, n));

  // Strip fork-controlled Pages control files before any deploy path ([R154]).
  const stripped = stripPagesControlFiles(siteDir);
  if (stripped.length)
    process.stderr.write(annotate('warning', msg.workflow.previewStripped(stripped)) + '\n');

  const { preview, problem } =
    typeof instanceRoot === 'object' && instanceRoot !== null
      ? { ...loadJournalPreview(null), problem: instanceRoot.problem }
      : loadJournalPreview(instanceRoot);
  if (problem) process.stderr.write(annotate('warning', problem) + '\n');
  // Deep-link the Build paper run holding the artifact (workflow_run.id), else the Actions tab.
  const runUrl = input.artifactRunId
    ? `${serverUrl}/${repo ?? ''}/actions/runs/${input.artifactRunId}`
    : `${serverUrl}/${repo ?? ''}/actions`;
  const plan = problem
    ? ({ mode: 'artifact', reason: problem } as PreviewPlan)
    : planPreview({ preview, cf, repo: repo ?? 'paper', pr });

  let outcome: Record<string, unknown>;
  if (plan.mode === 'cloudflare') {
    try {
      const url = await deps.deployer.deploy({
        dir: siteDir,
        accountId: plan.accountId,
        apiToken: plan.apiToken,
        projectName: plan.projectName,
        branch: plan.branch,
      });
      deps.gh.sticky(repoRoot, pr, STICKY_PREVIEW, previewComment(url));
      outcome = { preview: 'cloudflare', url, branch: plan.branch };
    } catch (e) {
      // A Cloudflare failure still gives the reviewer the artifact link. A gh failure below is
      // not caught; it throws.
      const failure = (e as Error).message;
      process.stderr.write(annotate('warning', msg.workflow.cloudflareDegraded(failure)) + '\n');
      deps.gh.sticky(
        repoRoot,
        pr,
        STICKY_PREVIEW,
        artifactComment(runUrl, msg.workflow.cloudflareDegradedReason(failure)),
      );
      outcome = {
        preview: 'artifact',
        reason: msg.workflow.previewCloudflareFailedReason(failure),
      };
    }
  } else {
    deps.gh.sticky(repoRoot, pr, STICKY_PREVIEW, artifactComment(runUrl, plan.reason));
    outcome = { preview: 'artifact', reason: plan.reason };
  }

  return ok({ pr, paper, ...outcome });
}
