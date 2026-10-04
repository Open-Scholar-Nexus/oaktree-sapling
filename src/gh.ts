/**
 * Everything oak does through `git` and `gh`, so the other modules can be tested without either:
 * the real implementations of their injected interfaces, plus the DOI pull request [R3], the
 * release assets [R24], the commit comment and the failure issue.
 */
import * as msg from './messages.js';
import { UserError } from './messages.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import type { GitContext } from './zenodo.js';
import { LABEL_ZENODO_FAILED, type GhPr, type PagesDeployer } from './preview.js';
import type { CheckRun } from './checks.js';
import type { EnvironmentReviewer, Provisioner } from './bootstrap.js';
import type { UpgradePr } from './upgrade.js';
import type { ConformanceGh } from './conformance.js';

/**
 * git and gh output is captured, so the user can tell what oak did from what a tool it called
 * printed ("Cloning into '/tmp/oak-seed-...'"). It stays quiet on success; on failure the
 * captured text is replayed with the tool's name on every line.
 * `--verbose` (`OAK_VERBOSE`) replays it on success too; CI always does for logs.
 */
function verboseChildren(): boolean {
  return Boolean(process.env.OAK_VERBOSE || process.env.CI);
}

/** Replays a child's captured output with its name on every line. */
export function labelChildOutput(tool: string, text: unknown): string {
  return String(text ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => `  [${tool}] ${l}`)
    .join('\n');
}

function echoChild(tool: string, text: unknown): void {
  const labelled = labelChildOutput(tool, text);
  if (labelled) process.stderr.write(labelled + '\n');
}

/**
 * Prints what is running, then erases the line [R85]: cloning or creating a repo takes seconds,
 * and silence reads as a hang. No spinner, since `spawnSync` blocks the event loop. Only on a
 * TTY: a log would keep the half-erased line, and CI prints child output anyway.
 */
function showWorking(tool: string, args: string[]): () => void {
  if (!process.stderr.isTTY || verboseChildren()) return () => {};
  process.stderr.write(
    msg.workflow.working(
      `${tool} ${args
        .filter((a) => !a.startsWith('-'))
        .slice(0, 2)
        .join(' ')}`,
    ),
  );
  return () => process.stderr.write('\r\u001b[K');
}

/**
 * Runs `git` or `gh` with both streams captured. `quiet` skips the replay even on failure, for
 * probes where a non-zero exit is an answer (does this ruleset exist?).
 */
function run(
  tool: 'git' | 'gh',
  args: string[],
  opts: { input?: string; cwd?: string; quiet?: boolean; env?: NodeJS.ProcessEnv } = {},
): string {
  const done = showWorking(tool, args);
  // spawnSync hands back stderr on success too, which the replay needs.
  const r = spawnSync(tool, args, {
    encoding: 'utf8',
    input: opts.input,
    cwd: opts.cwd,
    maxBuffer: 64 * 1024 * 1024,
    ...(opts.env ? { env: opts.env } : {}),
  });
  done();
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (!opts.quiet) echoChild(tool, r.stderr || r.stdout);
    const first =
      String(r.stderr || r.stdout || '')
        .split('\n')
        .find((l) => l.trim() !== '') ?? '';
    const err = new Error(
      `${tool} ${args[0] ?? ''} failed (exit ${r.status ?? `signal ${r.signal}`})${first ? `: ${first.trim()}` : ''}`,
    ) as Error & { status: number | null; stdout: string; stderr: string };
    err.status = r.status;
    err.stdout = String(r.stdout ?? '');
    err.stderr = String(r.stderr ?? '');
    throw err;
  }
  if (verboseChildren()) echoChild(tool, r.stderr);
  return String(r.stdout ?? '').trim();
}

function git(repoRoot: string, args: string[], opts: { quiet?: boolean } = {}): string {
  return run('git', ['-C', repoRoot, ...args], opts);
}

/** git without `-C`, run in `cwd`. */
function gitRaw(args: string[], cwd?: string): string {
  return run('git', args, { cwd });
}

function gh(args: string[], opts: { input?: string; cwd?: string; quiet?: boolean } = {}): string {
  return run('gh', args, opts);
}

/** An absent ref: the refs API answers 422 "Reference does not exist" where most endpoints say
 *  404, so every ref delete passes this to {@link ghOk} [R149]. */
export const ABSENT_REF = /Reference does not exist/i;

/** The answer when approving a run that needs no approval [R150]. */
export const NOT_GATED = /not waiting for approval/i;

/**
 * true when `gh <args>` returns 2xx, false when the target is absent (404, or `alsoAbsent`).
 * Anything else (403, 5xx, no `gh`) throws, so a refused DELETE never passes for a cleanup.
 */
function ghOk(args: string[], env?: NodeJS.ProcessEnv, alsoAbsent?: RegExp): boolean {
  const r = spawnSync('gh', args, { encoding: 'utf8', ...(env ? { env } : {}) });
  if (r.error) throw r.error;
  if (r.status === 0) return true;
  const stderr = String(r.stderr ?? '');
  if (/HTTP 404|not found/i.test(stderr)) return false;
  if (alsoAbsent?.test(stderr)) return false;
  throw new Error(`gh ${args[0] ?? ''} failed (exit ${r.status}): ${stderr.trim().split('\n')[0]}`);
}

/** `gh()` with `GH_TOKEN` set to `token`. Conformance uses it for calls on the fork. */
function ghAs(
  token: string,
  args: string[],
  opts: { input?: string; cwd?: string; quiet?: boolean } = {},
): string {
  return run('gh', args, { ...opts, env: { ...process.env, GH_TOKEN: token } });
}

/** {@link ghOk} with `GH_TOKEN` set to `token`. */
function ghOkAs(token: string, args: string[], alsoAbsent?: RegExp): boolean {
  return ghOk(args, { ...process.env, GH_TOKEN: token }, alsoAbsent);
}

/** `owner/name`, the shape every verb's usage line promises. Checked because the value reaches
 *  `gh` as a positional argument, where a leading dash is read as an option [R138]. */
const REPO_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function assertRepoName(repo: string): string {
  if (!REPO_NAME.test(repo)) throw new UserError(msg.workflow.badRepoName(repo));
  return repo;
}

/**
 * Both reach `git fetch` as positional arguments, which git still parses as options, so a ref
 * of `--upload-pack=<command>` runs the command [R103]. Only the two supported transports pass;
 * screening for `-` would miss `ext::`, which does the same. Credentials in the URL are refused,
 * since `--from` is copied into a public commit message.
 */
const INGEST_URL =
  /^(https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(\.git)?\/?$/;
const INGEST_REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

export function assertIngestSource(sourceUrl: string, sourceRef: string): void {
  if (!INGEST_URL.test(sourceUrl)) throw new UserError(msg.bootstrap.ingestBadUrl(sourceUrl));
  if (!INGEST_REF.test(sourceRef) || sourceRef.includes('..')) {
    throw new UserError(msg.bootstrap.ingestBadRef(sourceRef));
  }
}

/** Identity flags for committing as the bot; a CI runner has no git identity. */
const BOT_ID = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
];

/** The real `GitContext` for `cmdPublish`. */
export const realGitContext: GitContext = {
  async headSha(repoRoot) {
    return git(repoRoot, ['rev-parse', 'HEAD']);
  },
  async gitArchive(repoRoot, outZip) {
    git(repoRoot, ['archive', '--format=zip', '-o', outZip, 'HEAD']);
  },
  async reviewPr(repoRoot, sha) {
    // The tagged commit's pull request, from the API [R35.2].
    const repo = originRepo(repoRoot);
    if (!repo) return null;
    try {
      // Not quiet: a commit without a pull request exits 0 with no output, so only a real
      // failure lands here, and the log should explain a review_pr missing from the provenance.
      const out = gh(['api', `repos/${repo}/commits/${sha}/pulls`, '--jq', '.[0].number // empty']);
      return out || null;
    } catch {
      return null;
    }
  },
};

/** owner/repo from the origin remote, or null. */
export function originRepo(repoRoot: string): string | null {
  try {
    const url = git(repoRoot, ['remote', 'get-url', 'origin'], { quiet: true });
    const m = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/**
 * Opens the DOI pull request for the myst.yml write [R3]: a branch, a commit of myst.yml only,
 * a push and `gh pr create`. Returns its URL. Needs `gh` with a token.
 */
export function openDoiPr(repoRoot: string, opts: { conceptDoi: string }): string {
  // One branch name for every version: prepare reserves the concept DOI, and the version comes
  // from the tag at publish. Preparing again force-pushes the same branch.
  const branch = 'zenodo-doi';
  const repo = originRepo(repoRoot);
  const base = repo ? defaultBranch(repo) : 'main';
  // The branch starts at HEAD, so HEAD must be on the base, or the pull request would carry
  // more than the myst.yml change.
  git(repoRoot, ['fetch', 'origin', base, '--quiet']);
  try {
    git(repoRoot, ['merge-base', '--is-ancestor', 'HEAD', `origin/${base}`], { quiet: true });
  } catch {
    throw new UserError(msg.workflow.doiPrDiverged('HEAD', `origin/${base}`));
  }
  git(repoRoot, ['checkout', '-B', branch]);
  git(repoRoot, ['add', 'myst.yml']);
  git(repoRoot, [...BOT_ID, 'commit', '-m', `chore: reserve Zenodo DOI ${opts.conceptDoi}`]);
  git(repoRoot, ['push', '-u', 'origin', branch, '--force']);
  // `--repo`: the git calls use `-C repoRoot`, while `gh` would read the current directory's
  // repo. `realUpgradePr` uses `cwd` for the same.
  const scope = repo ? ['--repo', repo] : [];
  const create = [
    'pr',
    'create',
    ...scope,
    '--base',
    base,
    '--title',
    msg.workflow.doiPrTitle,
    '--body',
    msg.workflow.doiPrBody(opts.conceptDoi),
    '--head',
    branch,
  ];
  try {
    return gh(create);
  } catch (e) {
    // Preparing again is allowed [design §13], and `gh pr create` refuses a second pull request
    // for a branch, so return the open one.
    const existing = openPrUrl(repo, branch);
    if (existing) return existing;
    throw e;
  }
}

/** The repo's default branch, the base every DOI or upgrade pull request targets. */
function defaultBranch(repo: string): string {
  return gh(['api', `repos/${repo}`, '--jq', '.default_branch']) || 'main';
}

/** The open pull request for `branch`, or null. */
function openPrUrl(repo: string | null, branch: string): string | null {
  try {
    return (
      gh([
        'pr',
        'list',
        ...(repo ? ['--repo', repo] : []),
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'url',
        '--jq',
        '.[0].url // empty',
      ]) || null
    );
  } catch {
    return null;
  }
}

/** Attaches the deposit files to the tag's GitHub release [R24]: they outlast the 30-day
 *  artifact retention, and the deposited bytes sit next to the tag. */
export function uploadReleaseAsset(repoRoot: string, tag: string, files: string[]): void {
  const repo = originRepo(repoRoot);
  const base = ['release', ...(repo ? ['--repo', repo] : [])];
  // Quiet: no release yet is the usual case, and the create below answers it.
  try {
    gh([...base, 'view', tag], { quiet: true });
  } catch {
    gh([...base, 'create', tag, '--title', tag, '--notes', 'Automated deposit bundle.']);
  }
  gh([...base, 'upload', tag, ...files, '--clobber']);
}

/** A comment on the tagged commit when publishing succeeds. */
export function postCommitComment(repoRoot: string, sha: string, body: string): void {
  const repo = originRepo(repoRoot);
  if (!repo) return;
  gh(['api', `repos/${repo}/commits/${sha}/comments`, '-f', `body=${body}`]);
}

/** Opens a failure issue when publishing fails, labelled for the editors. */
export function openFailureIssue(repoRoot: string, title: string, body: string): void {
  const repo = originRepo(repoRoot);
  const base = ['issue', 'create', ...(repo ? ['--repo', repo] : [])];
  gh([...base, '--title', title, '--body', body, '--label', LABEL_ZENODO_FAILED]);
}

/* --------------------------------------------------------------------------
 * For preview.ts: deploy-preview and notify [R69]
 * ------------------------------------------------------------------------ */

/** The real pull request calls for `cmdDeployPreview` and the new-version reminder. A sticky
 *  comment carries a hidden HTML marker, so a rerun edits it in place. */
export const realGhPr: GhPr = {
  sticky(repoRoot, prNumber, header, body) {
    // Throws on failure, so check-post never reports a comment it did not post [R69].
    const repo = originRepo(repoRoot);
    if (!repo) throw new Error(msg.workflow.noOriginRepo(repoRoot));
    const marker = msg.stickyMarker(header);
    let existingId = '';
    try {
      existingId = gh([
        'api',
        `repos/${repo}/issues/${prNumber}/comments`,
        '--paginate',
        '--jq',
        `[.[] | select(.body | startswith("${marker}"))] | last | .id // empty`,
      ]);
    } catch {
      /* no comments or no read access: create one */
    }
    if (existingId) {
      gh(
        [
          'api',
          '--method',
          'PATCH',
          `repos/${repo}/issues/comments/${existingId}`,
          '-F',
          'body=@-',
        ],
        { input: body },
      );
    } else {
      gh(
        ['api', '--method', 'POST', `repos/${repo}/issues/${prNumber}/comments`, '-F', 'body=@-'],
        { input: body },
      );
    }
  },

  addLabel(repoRoot, prNumber, label, opts = {}) {
    const repo = originRepo(repoRoot);
    const scope = repo ? ['--repo', repo] : [];
    try {
      const create = ['label', 'create', label, ...scope];
      if (opts.color) create.push('--color', opts.color);
      if (opts.description) create.push('--description', opts.description);
      gh(create);
    } catch {
      /* the label already exists */
    }
    gh(['pr', 'edit', prNumber, ...scope, '--add-label', label]);
  },

  versionTags(_repoRoot, repo) {
    // From the API, since this job's checkout is shallow [R23]. A failure throws: [] would read
    // as never published.
    if (!repo) return [];
    const out = gh(['api', `repos/${repo}/tags`, '--paginate', '--jq', '.[].name']);
    return out
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t.startsWith('v'));
  },
};

/** Pinned [R109]. */
const WRANGLER_VERSION = '4.127.1';

/** The real Cloudflare Pages deployer for `cmdDeployPreview`: a wrangler direct upload, with the
 *  deployment URL read from its output. Any failure throws, and `cmdDeployPreview` falls back to
 *  an artifact link [R16]. */

export const realPagesDeployer: PagesDeployer = {
  async deploy(opts) {
    // stderr is passed through, not captured: captured stderr joins the error message, which
    // preview.ts posts publicly, and wrangler's names the account id [R104]. An empty cwd, so a
    // `.npmrc` or `node_modules/wrangler` in the paper cannot pick which wrangler runs.
    const cwd = mkdtempSync(join(tmpdir(), 'oak-wrangler-'));
    let out: string;
    try {
      out = execFileSync(
        'npx',
        [
          '--yes',
          `wrangler@${WRANGLER_VERSION}`,
          'pages',
          'deploy',
          resolve(opts.dir),
          `--project-name=${opts.projectName}`,
          `--branch=${opts.branch}`,
        ],
        {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: opts.apiToken,
            CLOUDFLARE_ACCOUNT_ID: opts.accountId,
          },
        },
      );
    } catch {
      throw new Error(msg.workflow.wranglerFailed);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    const m = /https?:\/\/[^\s]*\.pages\.dev[^\s]*/.exec(out);
    if (!m) throw new Error(msg.workflow.wranglerNoUrl);
    return m[0];
  },
};

/* --------------------------------------------------------------------------
 * For checks.ts: posting the journal check results as a Check Run, with a summary table and
 * inline annotations. Needs `checks: write`, so only the trusted `workflow_run` job.
 * ------------------------------------------------------------------------ */

export interface CheckRunPoster {
  create(repo: string, headSha: string, name: string, run: CheckRun): void;
}

/** Files changed between `base` and `head`, from the compare API. check-post passes `head` from
 *  `github.event.workflow_run.head_sha`, which GitHub sets and the fork's artifact cannot, so
 *  the gated-files warning cannot be dodged. Returns [] on any error, so the warning never
 *  fails the post. */
export function changedFiles(repo: string, base: string, head: string): string[] {
  try {
    const out = gh(
      ['api', `repos/${repo}/compare/${base}...${head}`, '--paginate', '--jq', '.files[].filename'],
      { quiet: true },
    );
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

export const realCheckRun: CheckRunPoster = {
  create(repo, headSha, name, run) {
    const body = JSON.stringify({
      name,
      head_sha: headSha,
      status: 'completed',
      conclusion: run.conclusion,
      output: { title: run.title, summary: run.summary, annotations: run.annotations },
    });
    gh(['api', '--method', 'POST', `repos/${repo}/check-runs`, '--input', '-'], { input: body });
  },
};

/* --------------------------------------------------------------------------
 * For bootstrap.ts: creating and setting up repos through `gh api` and `git`. Every
 * change reads the current state first, so a rerun is safe.
 * ------------------------------------------------------------------------ */

export const realProvisioner: Provisioner = {
  ownerType(owner) {
    return gh(['api', `users/${owner}`, '--jq', '.type']) === 'Organization'
      ? 'Organization'
      : 'User';
  },
  repoExists(repo) {
    return ghOk(['api', `repos/${repo}`]);
  },
  createRepo(repo, opts) {
    gh([
      'repo',
      'create',
      repo,
      opts.private ? '--private' : '--public',
      '--description',
      opts.description,
    ]);
  },
  defaultBranch(repo) {
    return gh(['api', `repos/${repo}`, '--jq', '.default_branch']);
  },
  setDefaultBranch(repo, branch) {
    gh(['api', '-X', 'PATCH', `repos/${repo}`, '-f', `default_branch=${branch}`]);
  },
  branchExists(repo, branch) {
    return ghOk(['api', `repos/${repo}/branches/${branch}`]);
  },
  seedBranch(repo, branch, sourceDir, message) {
    // Clone the empty repo through gh, so the remote and auth come from the user's gh
    // config, then copy in the rendered tree, commit and push.
    const tmp = mkdtempSync(join(tmpdir(), 'oak-seed-'));
    gh(['repo', 'clone', repo, tmp]);
    cpSync(sourceDir, tmp, { recursive: true });
    gitRaw(['checkout', '-B', branch], tmp);
    gitRaw(['add', '-A'], tmp);
    gitRaw([...BOT_ID, 'commit', '-m', message], tmp);
    gitRaw(['push', 'origin', `${branch}:${branch}`], tmp);
  },
  ingestReviewBranch(repo, opts) {
    assertIngestSource(opts.sourceUrl, opts.sourceRef);
    const tmp = mkdtempSync(join(tmpdir(), 'oak-ingest-'));
    gh(['repo', 'clone', repo, tmp]);
    gitRaw(['fetch', 'origin', 'main'], tmp);
    gitRaw(['fetch', opts.sourceUrl, opts.sourceRef], tmp);
    gitRaw(['checkout', '-B', 'review', 'origin/main'], tmp);
    gitRaw(['rm', '-rf', '.'], tmp);
    gitRaw(['checkout', 'FETCH_HEAD', '--', '.'], tmp);
    // Delete, then restore: `git checkout <tree> -- .github` overwrites the paths the tree has and
    // keeps the rest, so an author's file at a path main lacks would reach a branch pushed to the
    // base repo with our credentials [R121].
    gitRaw(['rm', '-rqf', '--ignore-unmatch', '--', '.github'], tmp);
    gitRaw(['checkout', 'origin/main', '--', '.github'], tmp);
    if (ghOk(['api', `repos/${repo}/contents/CODEOWNERS`])) {
      try {
        gitRaw(['checkout', 'origin/main', '--', 'CODEOWNERS'], tmp);
      } catch {
        /* CODEOWNERS may be under .github/, restored above */
      }
    }
    gitRaw(['add', '-A'], tmp);
    gitRaw([...BOT_ID, 'commit', '-m', opts.message], tmp);
    gitRaw(['push', 'origin', 'review'], tmp);
  },
  prExists(repo, head) {
    try {
      return (
        Number(
          gh(['pr', 'list', '--repo', repo, '--head', head, '--json', 'number', '--jq', 'length']),
        ) > 0
      );
    } catch {
      return false;
    }
  },
  openPr(repo, opts) {
    return gh([
      'api',
      `repos/${repo}/pulls`,
      '--method',
      'POST',
      '--field',
      `title=${opts.title}`,
      '--field',
      `head=${opts.head}`,
      '--field',
      `base=${opts.base}`,
      '--field',
      `body=${opts.body}`,
      '--jq',
      '.html_url',
    ]);
  },
  grantTeamWrite(repo, team) {
    const [org, slug] = team.split('/');
    gh(['api', '-X', 'PUT', `orgs/${org}/teams/${slug}/repos/${repo}`, '-f', 'permission=push']);
  },
  teamId(team) {
    const [org, slug] = team.split('/');
    return Number(gh(['api', `orgs/${org}/teams/${slug}`, '--jq', '.id']));
  },
  rulesetExists(repo, name) {
    try {
      return (
        gh([
          'api',
          `repos/${repo}/rulesets`,
          '--paginate',
          '--jq',
          `.[] | select(.name=="${name}") | .id`,
        ]) !== ''
      );
    } catch {
      return false;
    }
  },
  createRuleset(repo, body) {
    gh(['api', '-X', 'POST', `repos/${repo}/rulesets`, '--input', '-'], {
      input: JSON.stringify(body),
    });
  },
  pagesEnabled(repo) {
    return ghOk(['api', `repos/${repo}/pages`]);
  },
  enablePages(repo) {
    gh(['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow']);
  },
  actionsCanApprovePrs(repo) {
    return (
      gh([
        'api',
        `repos/${repo}/actions/permissions/workflow`,
        '--jq',
        '.can_approve_pull_request_reviews',
      ]) === 'true'
    );
  },
  allowActionsApprovePrs(repo) {
    // The PUT replaces the whole settings object, so the current default token permission is read
    // and sent back with it; leaving it out resets a journal's choice to 'read'.
    const current = gh([
      'api',
      `repos/${repo}/actions/permissions/workflow`,
      '--jq',
      '.default_workflow_permissions',
    ]);
    gh([
      'api',
      '-X',
      'PUT',
      `repos/${repo}/actions/permissions/workflow`,
      '-F',
      'can_approve_pull_request_reviews=true',
      '-f',
      `default_workflow_permissions=${current || 'read'}`,
    ]);
  },
  environmentExists(repo, name) {
    return ghOk(['api', `repos/${repo}/environments/${name}`]);
  },
  environmentReviewers(repo, name) {
    try {
      const out = gh([
        'api',
        `repos/${repo}/environments/${name}`,
        '--jq',
        '[.protection_rules[]? | select(.type == "required_reviewers") | ' +
          '.reviewers[]? | {type: .type, id: .reviewer.id}]',
      ]);
      const parsed: unknown = JSON.parse(out || '[]');
      return Array.isArray(parsed) ? (parsed as EnvironmentReviewer[]) : [];
    } catch {
      return [];
    }
  },
  upsertEnvironment(repo, name, reviewers) {
    // `--input`: an array of reviewer objects has no `--field` spelling.
    gh(['api', '-X', 'PUT', `repos/${repo}/environments/${name}`, '--input', '-'], {
      input: JSON.stringify({
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        reviewers,
      }),
    });
  },
  customBranchPolicies(repo, env) {
    return (
      gh([
        'api',
        `repos/${repo}/environments/${env}`,
        '--jq',
        '.deployment_branch_policy.custom_branch_policies // false',
      ]) === 'true'
    );
  },
  branchPolicyExists(repo, env, name) {
    try {
      return (
        gh([
          'api',
          `repos/${repo}/environments/${env}/deployment-branch-policies`,
          '--jq',
          `.branch_policies[] | select(.name=="${name}") | .id`,
        ]) !== ''
      );
    } catch {
      return false;
    }
  },
  createBranchPolicy(repo, env, name, type) {
    gh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/environments/${env}/deployment-branch-policies`,
      '--field',
      `name=${name}`,
      '--field',
      `type=${type}`,
    ]);
  },
  createLabel(repo, name, opts) {
    const args = ['label', 'create', name, '--repo', repo, '--force'];
    if (opts.color) args.push('--color', opts.color);
    if (opts.description) args.push('--description', opts.description);
    // `--force` covers an existing label, so any error is real, and the step runner records it
    // [R127].
    gh(args);
  },
  setSecret(repo, env, name, value) {
    // stdin: argv is world-readable in /proc [R104].
    gh(['secret', 'set', name, '--repo', repo, '--env', env], { input: value });
  },
  secretNames(repo, env) {
    const args = ['secret', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name'];
    if (env) args.push('--env', env);
    try {
      return gh(args).split('\n').filter(Boolean);
    } catch {
      return [];
    }
  },
  deleteRepoSecret(repo, name) {
    gh(['secret', 'delete', name, '--repo', repo]);
  },
  repoVisibility(repo) {
    return gh(['api', `repos/${repo}`, '--jq', '.visibility']) === 'private' ? 'private' : 'public';
  },
  setRepoPublic(repo) {
    gh(['api', '-X', 'PATCH', `repos/${repo}`, '-F', 'private=false']);
  },
};

/* --------------------------------------------------------------------------
 * For upgrade.ts: the target version, the template, the upgrade pull request
 * ------------------------------------------------------------------------ */

/** The authenticated gh user login (`gh api user`). */
export function authedUser(): string {
  return gh(['api', 'user', '--jq', '.login']);
}

/** `oak bootstrap`'s check that gh is installed and logged in, reported as a sentence [R110]. */
export function assertGhReady(): void {
  try {
    gh(['--version'], { quiet: true });
  } catch {
    throw new UserError(msg.bootstrap.ghMissing);
  }
  try {
    gh(['auth', 'status'], { quiet: true });
  } catch {
    throw new UserError(msg.bootstrap.ghNotAuthed);
  }
}

/** A full clone of `repo` into a temporary directory, for an upgrade. */
export function tempClone(repo: string): string {
  const tmp = mkdtempSync(join(tmpdir(), 'oak-upgrade-'));
  gh(['repo', 'clone', repo, tmp]);
  return tmp;
}

/**
 * The latest stable release tag of `engineRepo`, from the `releases/latest` API: the newest
 * release that is neither a draft nor a pre-release, so `oak bootstrap` and the weekly upgrade
 * never pick a pre-release (RELEASING.md). One is used only when named (`--engine-version`,
 * `--to`). A 404 means no stable release yet: the probe is quiet, and `oak bootstrap` and
 * `oak upgrade` say how to proceed.
 */
export function latestEngineRelease(engineRepo: string): string {
  let tag = '';
  try {
    tag = gh(['api', `repos/${engineRepo}/releases/latest`, '--jq', '.tag_name'], { quiet: true });
  } catch {
    throw new Error(msg.workflow.noStableRelease(engineRepo));
  }
  if (!tag) throw new Error(msg.workflow.noStableRelease(engineRepo));
  return tag;
}

/** Shallow-clones `engineRepo` at `tag` and returns its `templates/paper/` path: `oak upgrade`
 *  resets only the paper's gated files, and the journal repo is never reset. */
export function materializeTemplate(engineRepo: string, tag: string): string {
  const tmp = mkdtempSync(join(tmpdir(), 'oak-tmpl-'));
  gh(['repo', 'clone', engineRepo, tmp, '--', '--depth', '1', '--branch', tag]);
  return join(tmp, 'templates', 'paper');
}

/** The upgrade pull request, opened like the DOI one: branch, commit as the bot, push, create. */
export const realUpgradePr: UpgradePr = {
  open(repoRoot, opts) {
    git(repoRoot, ['checkout', '-B', opts.branch]);
    git(repoRoot, ['add', ...opts.paths]);
    git(repoRoot, [...BOT_ID, 'commit', '-m', opts.title]);
    git(repoRoot, ['push', '-u', 'origin', opts.branch, '--force']);
    // Run `gh` inside the clone so it finds the repo from the remote: in CI the cwd is
    // already the repo, while a local `oak upgrade` works in a temporary clone.
    return gh(['pr', 'create', '--title', opts.title, '--body', opts.body, '--head', opts.branch], {
      cwd: repoRoot,
    });
  },
};

/** A value from the test repo's `myst.yml` on the default branch, read through the
 *  Contents API, so no clone is needed. null when absent or unreadable. */
function committedMystValue(repo: string, path: string[]): string | null {
  let content: string;
  try {
    content = gh(['api', `repos/${repo}/contents/myst.yml`, '--jq', '.content'], { quiet: true });
  } catch {
    return null; // no myst.yml / no read access
  }
  if (!content) return null;
  // GitHub wraps the base64 in newlines; Buffer ignores them.
  const value = parseDocument(Buffer.from(content, 'base64').toString('utf8')).getIn(path);
  return value != null ? String(value) : null;
}

/** Branch names from a `git/matching-refs/heads/<prefix>` listing, without `refs/heads/`. */
function matchingHeadRefs(out: string): string[] {
  return out ? out.split('\n').map((r) => r.replace(/^refs\/heads\//, '')) : [];
}

/** The real GitHub calls for `oak conformance`, run with the test repo's token (gh reads
 *  GH_TOKEN). Deleting something already gone is fine. */
export const realConformanceGh: ConformanceGh = {
  listOpenPrs(repo, label) {
    // `gh pr list --label` fails when the label does not exist yet: no pull requests.
    let out: string;
    try {
      out = gh(
        [
          'pr',
          'list',
          '--repo',
          repo,
          '--state',
          'open',
          '--label',
          label,
          '--json',
          'number,headRefName',
        ],
        { quiet: true },
      );
    } catch {
      return [];
    }
    if (!out) return [];
    return (JSON.parse(out) as { number: number; headRefName: string }[]).map((p) => ({
      number: p.number,
      headRef: p.headRefName,
    }));
  },
  closePr(repo, prNumber) {
    gh(['pr', 'close', String(prNumber), '--repo', repo]);
  },
  listBranches(repo, prefix) {
    // matching-refs returns refs whose name starts with the path ([] when none).
    const out = gh([
      'api',
      `repos/${repo}/git/matching-refs/heads/${prefix}`,
      '--paginate',
      '--jq',
      '.[].ref',
    ]);
    return matchingHeadRefs(out);
  },
  deleteBranch(repo, branch) {
    ghOk(['api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`], undefined, ABSENT_REF);
  },
  listTags(repo, marker) {
    // The API cannot filter by substring, so tags are listed and matched here.
    const out = gh(['api', `repos/${repo}/tags`, '--paginate', '--jq', '.[].name']);
    return out ? out.split('\n').filter((t) => t.includes(marker)) : [];
  },
  deleteTag(repo, tag) {
    ghOk(['api', '-X', 'DELETE', `repos/${repo}/git/refs/tags/${tag}`], undefined, ABSENT_REF);
  },
  labelPr(repo, prNumber, label) {
    gh(['pr', 'edit', String(prNumber), '--repo', repo, '--add-label', label]);
  },
  prHeadSha(repo, prNumber) {
    return gh([
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repo,
      '--json',
      'headRefOid',
      '--jq',
      '.headRefOid',
    ]);
  },
  mergePr(repo, prNumber) {
    gh(['pr', 'merge', String(prNumber), '--repo', repo, '--merge', '--delete-branch']);
    return gh([
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repo,
      '--json',
      'mergeCommit',
      '--jq',
      '.mergeCommit.oid',
    ]);
  },
  workflowRunsForCommit(repo, sha) {
    const out = gh([
      'api',
      `repos/${repo}/actions/runs?head_sha=${sha}`,
      '--jq',
      '[.workflow_runs[] | {id, name, status, conclusion, url: .html_url, event}]',
    ]);
    return out ? (JSON.parse(out) as import('./conformance.js').WorkflowRun[]) : [];
  },
  checkRunsForCommit(repo, sha) {
    const out = gh([
      'api',
      `repos/${repo}/commits/${sha}/check-runs`,
      '--jq',
      '[.check_runs[] | {name, conclusion}]',
    ]);
    return out ? (JSON.parse(out) as import('./conformance.js').CheckRunRef[]) : [];
  },
  openPreviewPr(repo, branch, marker) {
    // Branch off main, then append a MyST `%` comment to index.md through the Contents API: no
    // clone, so no git credentials needed in CI.
    const mainSha = gh(['api', `repos/${repo}/git/ref/heads/main`, '--jq', '.object.sha']);
    gh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/git/refs`,
      '-f',
      `ref=refs/heads/${branch}`,
      '-f',
      `sha=${mainSha}`,
    ]);

    const meta = JSON.parse(
      gh([
        'api',
        `repos/${repo}/contents/index.md?ref=${branch}`,
        '--jq',
        '{content: .content, sha: .sha}',
      ]),
    ) as {
      content: string;
      sha: string;
    };
    const current = Buffer.from(meta.content, 'base64').toString('utf8'); // GitHub wraps base64 in \n; Buffer ignores them
    const updated = Buffer.from(`${current}\n% conformance ${marker}\n`, 'utf8').toString('base64');
    gh([
      'api',
      '-X',
      'PUT',
      `repos/${repo}/contents/index.md`,
      '-f',
      `message=conformance preview probe ${marker}`,
      '-f',
      `content=${updated}`,
      '-f',
      `sha=${meta.sha}`,
      '-f',
      `branch=${branch}`,
    ]);

    const url = gh([
      'pr',
      'create',
      '--repo',
      repo,
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      `conformance preview ${marker}`,
      '--body',
      'Automated conformance preview probe; opened and closed by the harness.',
    ]);
    const number = Number(url.split('/').pop());
    const headSha = gh(['api', `repos/${repo}/git/ref/heads/${branch}`, '--jq', '.object.sha']);
    return { number, headSha };
  },
  listIssueComments(repo, prNumber) {
    // These pull requests stay far below a page of comments; `--paginate` would join the pages'
    // JSON arrays into invalid JSON.
    const out = gh(['api', `repos/${repo}/issues/${prNumber}/comments`, '--jq', '[.[].body]']);
    return out ? (JSON.parse(out) as string[]) : [];
  },
  committedDoi(repo) {
    return committedMystValue(repo, ['project', 'doi']);
  },
  committedEngineVersion(repo) {
    return committedMystValue(repo, ['project', 'options', 'oaktree-sapling', 'version']);
  },
  defaultBranchSha(repo) {
    return gh(['api', `repos/${repo}/git/ref/heads/main`, '--jq', '.object.sha']);
  },
  pushTag(repo, tag, sha) {
    gh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/git/refs`,
      '-f',
      `ref=refs/tags/${tag}`,
      '-f',
      `sha=${sha}`,
    ]);
  },
  releaseAssets(repo, tag) {
    // `gh release view` fails when there is no release yet: no assets.
    try {
      const out = gh(
        ['release', 'view', tag, '-R', repo, '--json', 'assets', '--jq', '[.assets[].name]'],
        { quiet: true },
      );
      return out ? (JSON.parse(out) as string[]) : [];
    } catch {
      return [];
    }
  },
  deleteRelease(repo, tag) {
    // `--cleanup-tag` also deletes the tag. A missing release is fine.
    ghOk(['release', 'delete', tag, '-R', repo, '-y', '--cleanup-tag']);
  },

  // --- a pull request from a fork and its preview (optional) ---
  sweepForkBranches(forkRepo, forkToken, prefix) {
    // Remove branches a crashed run left on the fork, as on the test repo, with the
    // fork's token.
    const out = ghAs(forkToken, [
      'api',
      `repos/${forkRepo}/git/matching-refs/heads/${prefix}`,
      '--jq',
      '.[].ref',
    ]);
    const branches = matchingHeadRefs(out);
    for (const branch of branches) {
      ghOkAs(
        forkToken,
        ['api', '-X', 'DELETE', `repos/${forkRepo}/git/refs/heads/${branch}`],
        ABSENT_REF,
      );
    }
    return branches;
  },
  openForkPr(baseRepo, forkRepo, forkToken, branch, tag, marker) {
    // Off the test repo's main: a pull request that conflicts with it starts no workflow.
    const forkOwner = forkRepo.split('/')[0];
    const headSha = gh(['api', `repos/${baseRepo}/git/ref/heads/main`, '--jq', '.object.sha']);
    ghAs(forkToken, [
      'api',
      '-X',
      'POST',
      `repos/${forkRepo}/git/refs`,
      '-f',
      `ref=refs/heads/${branch}`,
      '-f',
      `sha=${headSha}`,
    ]);

    const meta = JSON.parse(
      ghAs(forkToken, [
        'api',
        `repos/${forkRepo}/contents/myst.yml?ref=${branch}`,
        '--jq',
        '{content: .content, sha: .sha}',
      ]),
    ) as { content: string; sha: string };
    const doc = parseDocument(Buffer.from(meta.content, 'base64').toString('utf8')); // GitHub wraps base64 in \n; Buffer ignores them
    doc.setIn(['project', 'options', 'oaktree-sapling', 'version'], tag);
    const updated = Buffer.from(String(doc), 'utf8').toString('base64');
    ghAs(forkToken, [
      'api',
      '-X',
      'PUT',
      `repos/${forkRepo}/contents/myst.yml`,
      '-f',
      `message=conformance fork preview ${marker} (pin engine ${tag})`,
      '-f',
      `content=${updated}`,
      '-f',
      `sha=${meta.sha}`,
      '-f',
      `branch=${branch}`,
    ]);

    // Open the pull request on the test repo with the main token; `--head owner:branch`
    // names the fork's branch.
    const url = gh([
      'pr',
      'create',
      '--repo',
      baseRepo,
      '--base',
      'main',
      '--head',
      `${forkOwner}:${branch}`,
      '--title',
      `conformance fork preview ${marker}`,
      '--body',
      'Automated conformance fork-PR preview probe; opened and closed by the harness.',
    ]);
    const number = Number(url.split('/').pop());
    // Read the fork branch's head again: the PUT moved it.
    const postSha = ghAs(forkToken, [
      'api',
      `repos/${forkRepo}/git/ref/heads/${branch}`,
      '--jq',
      '.object.sha',
    ]);
    return { number, headSha: postSha };
  },
  deleteForkBranch(forkRepo, forkToken, branch) {
    ghOkAs(
      forkToken,
      ['api', '-X', 'DELETE', `repos/${forkRepo}/git/refs/heads/${branch}`],
      ABSENT_REF,
    );
  },
  approveWorkflowRun(repo, runId) {
    // First-time-contributor approval is on the test repo, so it uses the main token. Fork runs
    // are not always held [R150].
    ghOk(
      ['api', '-X', 'POST', `repos/${repo}/actions/runs/${runId}/approve`],
      undefined,
      NOT_GATED,
    );
  },
};
