/**
 * `oak deploy-preview` and `oak notify` [R16] [R26] [R27]. deploy-preview never fails the run
 * [R16]: missing secrets, a Cloudflare outage or a bad journal.yml all fall back to a comment
 * linking the build artifact. It runs in the trusted `workflow_run` job, which can write to the
 * pull request, so the new-version reminder runs there too. Cloudflare, git and gh are
 * injected; the real ones are in gh.ts.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readDoc, readJournalConfig } from './yaml-io.js';
import * as msg from './messages.js';
import { annotate, firstLine, stickyMarker } from './messages.js';
import { JournalConfig, PAPER_VERSION_TAG, parseZenodoDoi, type PreviewConfig } from './schema.js';
import { resolvePaperDir, takePaperDir, takePrNumber, verifyPrHead } from './artifact.js';
import { err, ok, type Outcome } from './result.js';

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
  /** Add a label to a PR, creating the label first if it does not exist. */
  addLabel(
    repoRoot: string,
    prNumber: string,
    label: string,
    opts?: { color?: string; description?: string },
  ): void;
  /** The {@link PAPER_VERSION_TAG} tags through `gh api` [R23], since this job's checkout is
   *  shallow. `repo` null means no tags. */
  versionTags(repoRoot: string, repo: string | null): string[];
  /** The head commit of pull request `pr`, for {@link verifyPrHead}. */
  prHead(repo: string, pr: string): string;
}

/* --------------------------------------------------------------------------
 * Sticky comment headers and labels. Do not rename: GitHub stores them
 * ------------------------------------------------------------------------ */

export const STICKY_PREVIEW = 'oak-preview';
export const STICKY_NEWVERSION = 'zenodo-newversion-reminder';
export const LABEL_EDITOR_ACTION = 'editor-action-needed';
/** Here rather than beside its issue, so `oak bootstrap` creates the label `openFailureIssue`
 *  uses [R127]. */
export const LABEL_ZENODO_FAILED = 'zenodo-publish-failed';

/* --------------------------------------------------------------------------
 * journal.yml `preview:` settings [R27], read as loadJournalZenodo reads `zenodo:`
 * ------------------------------------------------------------------------ */

/** Reads `preview:` from `<instanceRoot>/journal.yml`, with the schema defaults when absent. A
 *  file that fails to parse is the journal's mistake, so it falls back and `problem` says why
 *  in the comment [R16] [R140]. */
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
 *  truncated name so two papers sharing one Pages project stay distinct ([R139]). */
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

/** Deploy to Cloudflare, or degrade to an artifact link with a reason ([R6]): needs
 *  `provider: cloudflare`, both secrets, and a `cf_project_name`. */
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

/** The Zenodo record URL of a {@link parseZenodoDoi} DOI, on the sandbox or not; any other DOI
 *  returns an error the caller fails loud on, since a published paper's DOI must parse. */
export function recordUrlForDoi(
  doi: string,
): { doi: string; recordUrl: string } | { error: string } {
  const parsed = parseZenodoDoi(doi);
  if (!parsed) return { error: msg.workflow.notifyBadDoi(doi) };
  const base = parsed.sandbox
    ? 'https://sandbox.zenodo.org/records/'
    : 'https://zenodo.org/records/';
  return { doi, recordUrl: `${base}${parsed.recordId}` };
}

/** Whether the paper already has a version tag `oak release` publishes (⇒ a new-version
 *  reminder is due). */
export function hasVersionTag(tags: string[]): boolean {
  return tags.some((t) => PAPER_VERSION_TAG.test(t.trim()));
}

export function newVersionComment(doi: string, recordUrl: string): string {
  return [stickyMarker(STICKY_NEWVERSION), msg.pr.newVersionReminder(doi, recordUrl)].join('\n');
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
  /** `--myst`; else the paper's myst.yml in `repoRoot`, for the notify DOI read. */
  mystPath?: string;
}

export interface PreviewDeps {
  deployer: PagesDeployer;
  gh: GhPr;
}

/** `oak deploy-preview <site>` [R16]: deploys the build artifact to a preview URL, or falls
 *  back to a link to it, and comments on the pull request. Without a pull request it does
 *  nothing. It fails only when the pull request check refuses ({@link verifyPrHead}) or the
 *  new-version reminder fails. Documented at DOCS.deployPreview. */
export async function cmdDeployPreview(
  input: DeployPreviewInput,
  deps: PreviewDeps,
): Promise<Outcome> {
  const { siteDir, repoRoot, instanceRoot, repo, serverUrl, cf } = input;
  // Both files leave the site before anything else, so neither is served.
  const pr = takePrNumber(siteDir);
  const paper = resolvePaperDir(input.paper, takePaperDir(siteDir));
  if (!pr) {
    process.stderr.write(msg.workflow.noPrNumber + '\n');
    return ok({ preview: 'skipped', reason: msg.workflow.previewNoPrNumberReason });
  }
  verifyPrHead(repo, pr, input.verifiedHead, (r, n) => deps.gh.prHead(r, n));
  const mystPath = input.mystPath ?? join(repoRoot, paper, 'myst.yml');

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
      // The one fallback [R16]: a Cloudflare failure still gives the reviewer the artifact link.
      // A gh failure below is not caught; it throws.
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

  // The new-version reminder runs here, where the job can write to the pull request [R16]; its
  // failure propagates.
  const notify = runNewVersionReminder({ repoRoot, mystPath, repo, pr }, deps.gh);
  return {
    exitCode: notify.exitCode,
    result: { status: notify.result.status, pr, paper, ...outcome, notify: notify.result },
  };
}

export interface NotifyInput {
  repoRoot: string;
  mystPath: string;
  repo: string | null;
  /** The PR to comment on. deploy-preview passes the number it already read+stripped. */
  pr: string;
}

/** The new-version reminder [R16] [R23]: on a paper already published, posts a sticky reminder
 *  and a label. Before the first deposit (no version tag) it does nothing. A version tag with no
 *  readable DOI means published but unlinked, and fails (exit 1). */
export function runNewVersionReminder(input: NotifyInput, gh: GhPr): Outcome {
  const { repoRoot, mystPath, repo, pr } = input;
  let tags: string[];
  try {
    tags = gh.versionTags(repoRoot, repo);
  } catch (e) {
    // An unreadable tag list must not read as "never published".
    const why = String((e as Error).message ?? e);
    process.stderr.write(annotate('error', msg.workflow.notifyTagsFailed(why)) + '\n');
    return err(1, why, { reminder: 'error' });
  }
  if (!hasVersionTag(tags)) {
    return ok({ reminder: 'skipped', reason: msg.workflow.notifyFirstDeposit });
  }

  let doi: string | null;
  try {
    doi = readProjectDoi(mystPath);
  } catch (e) {
    // A myst.yml with a YAML error (`readDoc`); the preview comment is already posted.
    const why = firstLine(e);
    process.stderr.write(annotate('error', why) + '\n');
    return err(1, why, { reminder: 'error' });
  }
  if (!doi) {
    process.stderr.write(annotate('error', msg.workflow.notifyPublishedButUnlinked) + '\n');
    return err(1, 'version tag present but project.doi missing', { reminder: 'error' });
  }
  const parsed = recordUrlForDoi(doi);
  if ('error' in parsed) {
    process.stderr.write(
      annotate('error', msg.workflow.notifyRecordUrlFailed(parsed.error)) + '\n',
    );
    return err(1, parsed.error, { reminder: 'error' });
  }

  gh.sticky(repoRoot, pr, STICKY_NEWVERSION, newVersionComment(parsed.doi, parsed.recordUrl));
  gh.addLabel(repoRoot, pr, LABEL_EDITOR_ACTION, {
    color: 'b60205',
    description: msg.bootstrap.labelEditorAction,
  });
  return ok({ reminder: 'posted', record_url: parsed.recordUrl, doi: parsed.doi });
}

/** `project.doi` from a myst.yml, or null. */
function readProjectDoi(mystPath: string): string | null {
  if (!existsSync(mystPath)) return null;
  const doi = readDoc(mystPath).getIn(['project', 'doi']);
  return typeof doi === 'string' && doi ? doi : null;
}
