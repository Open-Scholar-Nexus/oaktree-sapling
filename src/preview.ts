/**
 * `oak deploy-preview` [R16] [R26] [R27]. It never fails the run [R16]: missing secrets, a
 * Cloudflare outage or a bad journal.yml all fall back to a comment linking the build artifact.
 * It runs in the trusted `workflow_run` job, which can write to the pull request. Cloudflare,
 * git and gh are injected; the real ones are in gh.ts.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJournalConfig } from './yaml-io.js';
import * as msg from './messages.js';
import { annotate, firstLine, stickyMarker } from './messages.js';
import { JournalConfig, type PreviewConfig } from './schema.js';
import { folderId } from './projects.js';
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
/** Here rather than beside its issue, so `oak bootstrap` creates the label `openFailureIssue`
 *  uses [R127]. */
export const LABEL_ZENODO_FAILED = 'zenodo-publish-failed';

/* --------------------------------------------------------------------------
 * journal.yml `preview:` settings [R27], read as loadJournalZenodo reads `zenodo:`
 * ------------------------------------------------------------------------ */

/** Reads `preview:` from `<journalRoot>/journal.yml`, with the schema defaults when absent. A
 *  file that fails to parse is the journal's mistake, so it falls back and `problem` says why
 *  in the comment [R16] [R140]. */
export function loadJournalPreview(journalRoot: string | null): {
  preview: PreviewConfig;
  problem?: string;
} {
  const empty = () => ({ preview: JournalConfig.parse({ name: 'x' }).preview });
  if (!journalRoot) return empty();
  try {
    const journal = readJournalConfig(journalRoot);
    return journal ? { preview: journal.preview } : empty();
  } catch (e) {
    return { ...empty(), problem: msg.workflow.previewBadJournal(firstLine(e)) };
  }
}

/* --------------------------------------------------------------------------
 * Pure logic
 * ------------------------------------------------------------------------ */

/** Cloudflare Pages runs these from the deploy root: `_worker.js`/`functions/` are code,
 *  `_redirects`/`_headers`/`_routes.json` rewrite responses. A fork controls the artifact, so a
 *  new entry must be one of those two kinds ([R154]). */
const PAGES_CONTROL_FILES = [
  '_worker.js',
  'functions',
  '_routes.json',
  '_redirects',
  '_headers',
  '_middleware.js',
];

/** Remove Pages control files from the deploy root; returns the names removed ([R154]). */
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

/** `{repo}`/`{pr}` → a Cloudflare-Pages branch alias (lowercase `[a-z0-9-]`, ≤28 chars).
 *  Spend the budget on `{repo}` last so a long name cannot truncate away `{pr}`, and hash a
 *  truncated name so two papers sharing one Pages project stay distinct ([R139]). A co-located
 *  paper's id joins the repo name in `{repo}`, so each paper of a pull request gets its own. */
export function previewBranch(pattern: string, repo: string, pr: string, paper?: string): string {
  const shortRepo = repo.includes('/') ? repo.slice(repo.indexOf('/') + 1) : repo;
  const withPr = pattern.replaceAll('{pr}', pr);
  const fixed = slug(withPr.replaceAll('{repo}', ''));
  const full = slug(paper ? `${shortRepo}-${paper}` : shortRepo);
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

/** Deploy to Cloudflare, or degrade to an artifact link with a reason ([R6]): needs
 *  `provider: cloudflare`, both secrets, and a `cf_project_name`. */
export function planPreview(input: {
  preview: PreviewConfig;
  cf: { apiToken?: string; accountId?: string };
  repo: string;
  pr: string;
  /** A co-located paper's id; absent for the paper at a repository root. */
  paper?: string;
}): PreviewPlan {
  const { preview, cf, repo, pr, paper } = input;
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
    branch: previewBranch(preview.branch_pattern, repo, pr, paper),
  };
}

/** A sticky header for one paper: `header` itself for the paper at a repository root, which
 *  keeps the comments posted before co-located papers existed, else `header:<id>`. */
export function paperSticky(header: string, paper?: string): string {
  return paper ? `${header}:${paper}` : header;
}

export function previewComment(url: string, paper?: string): string {
  return [
    stickyMarker(paperSticky(STICKY_PREVIEW, paper)),
    msg.pr.previewDeployed(url, paper),
  ].join('\n');
}

export function artifactComment(runUrl: string, reason: string, paper?: string): string {
  return [
    stickyMarker(paperSticky(STICKY_PREVIEW, paper)),
    msg.pr.previewArtifact(runUrl, reason, paper),
  ].join('\n');
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
  journalRoot: string | null | { problem: string };
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

/** `oak deploy-preview <site>` [R16]: deploys the build artifact to a preview URL, or falls
 *  back to a link to it, and comments on the pull request. Without a pull request it does
 *  nothing. It fails only when the pull request check refuses ({@link verifyPrHead}).
 *  Documented at DOCS.deployPreview. */
export async function cmdDeployPreview(
  input: DeployPreviewInput,
  deps: PreviewDeps,
): Promise<Outcome> {
  const { siteDir, repoRoot, journalRoot, repo, serverUrl, cf } = input;
  // Both files leave the site before anything else, so neither is served.
  const pr = takePrNumber(siteDir);
  const paper = resolvePaperDir(input.paper, takePaperDir(siteDir));
  if (!pr) {
    process.stderr.write(msg.workflow.noPrNumber + '\n');
    return ok({ preview: 'skipped', reason: msg.workflow.previewNoPrNumberReason });
  }
  verifyPrHead(repo, pr, input.verifiedHead, (r, n) => deps.gh.prHead(r, n));
  const id = folderId(paper) ?? undefined;
  const header = paperSticky(STICKY_PREVIEW, id);

  // Strip fork-controlled Pages control files before any deploy path ([R154]).
  const stripped = stripPagesControlFiles(siteDir);
  if (stripped.length)
    process.stderr.write(annotate('warning', msg.workflow.previewStripped(stripped)) + '\n');

  const { preview, problem } =
    typeof journalRoot === 'object' && journalRoot !== null
      ? { ...loadJournalPreview(null), problem: journalRoot.problem }
      : loadJournalPreview(journalRoot);
  if (problem) process.stderr.write(annotate('warning', problem) + '\n');
  // Deep-link the Build paper run holding the artifact (workflow_run.id), else the Actions tab.
  const runUrl = input.artifactRunId
    ? `${serverUrl}/${repo ?? ''}/actions/runs/${input.artifactRunId}`
    : `${serverUrl}/${repo ?? ''}/actions`;
  const plan = problem
    ? ({ mode: 'artifact', reason: problem } as PreviewPlan)
    : planPreview({ preview, cf, repo: repo ?? 'paper', pr, paper: id });

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
      deps.gh.sticky(repoRoot, pr, header, previewComment(url, id));
      outcome = { preview: 'cloudflare', url, branch: plan.branch };
    } catch (e) {
      // The one fallback [R16]: a Cloudflare failure still gives the reviewer the artifact link.
      // A gh failure below is not caught; it throws.
      const failure = (e as Error).message;
      process.stderr.write(annotate('warning', msg.workflow.cloudflareDegraded(failure)) + '\n');
      deps.gh.sticky(
        repoRoot,
        pr,
        header,
        artifactComment(runUrl, msg.workflow.cloudflareDegradedReason(failure), id),
      );
      outcome = {
        preview: 'artifact',
        reason: msg.workflow.previewCloudflareFailedReason(failure),
      };
    }
  } else {
    deps.gh.sticky(repoRoot, pr, header, artifactComment(runUrl, plan.reason, id));
    outcome = { preview: 'artifact', reason: plan.reason };
  }

  return ok({ pr, paper, ...outcome });
}
