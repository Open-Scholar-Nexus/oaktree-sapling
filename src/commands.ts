/**
 * The flags each command takes, read by args.ts: what oak accepts, and what its usage text shows.
 * A command reads only the flags its table lists.
 */
import type { CommandSpec } from './args.js';
import { DOCS } from './docs-links.js';

const paper = { name: 'paper', value: '<dir>' } as const;
const instance = [{ name: 'instance', value: '<dir>' }, { name: 'no-instance' }] as const;
const typstTemplate = { name: 'typst-template', value: '<dir>' } as const;
const baseUrl = { name: 'base-url', value: '<url>' } as const;
const noSiteTemplate = { name: 'no-site-template' } as const;
const repo = { name: 'repo', value: '<owner/name>' } as const;
const yes = { name: 'yes' } as const;
const sandbox = { name: 'sandbox' } as const;
const token = { name: 'token', value: '<token>' } as const;
const siteUrl = { name: 'site-url', value: '<url>' } as const;
const myst = { name: 'myst', value: '<path>', hidden: true } as const;
const publish = { name: 'publish-without-review' } as const;
const port = { name: 'port', value: '<n>' } as const;
const serverPort = { name: 'server-port', value: '<n>' } as const;
const keepHost = { name: 'keep-host' } as const;
const engineFlags = [
  { name: 'engine-repo', value: '<owner/name>' },
  { name: 'engine-version', value: '<tag>' },
  { name: 'owner', value: '<@user|@org/team>' },
] as const;
const secrets = [
  { name: 'zenodo-token', value: '<token>' },
  { name: 'zenodo-token-sandbox', value: '<token>' },
  { name: 'cf-token', value: '<token>' },
  { name: 'cf-account', value: '<id>' },
] as const;

/** A command's table, and the docs page `oak <command> --help` points to. */
type Command = CommandSpec & { readonly docs: string };

export const COMMANDS = {
  bootstrapJournal: {
    name: 'bootstrap journal',
    flags: [
      { ...repo, required: true },
      { name: 'name', value: '<name>' },
      { name: 'edition', value: '<id>' },
      ...engineFlags,
      { name: 'no-require-checks' },
      { name: 'no-site' },
      {
        name: 'co-located',
        help: 'not ready: one repo for the journal and its papers, with no journal website; for now, with a single paper',
      },
      yes,
      ...secrets.map((s) => ({ ...s, hidden: true })),
    ],
    summary:
      "a public repo with the journal's settings, branding, website and list of published papers; each paper is in a repo of its own that points back at it",
    docs: DOCS.bootstrap,
  },
  bootstrapPaper: {
    name: 'bootstrap paper',
    flags: [
      { ...repo, required: true },
      {
        name: 'instance',
        value: '<owner/journal-repo>',
        required: true,
        help: "the journal repo this paper belongs to ('.' only if the journal settings are in this same repo); --edition names one of its editions",
      },
      { name: 'edition', value: '<id>', required: true },
      { name: 'from', value: '<author-url>' },
      { name: 'source-ref', value: '<ref>', help: 'the branch or tag of --from to copy' },
      ...engineFlags,
      { name: 'private' },
      { name: 'no-require-checks' },
      yes,
      ...secrets,
    ],
    summary: "a repo for one paper, set up to build and publish with its journal's settings",
    docs: DOCS.bootstrap,
  },
  upgrade: {
    name: 'upgrade',
    flags: [
      [
        { ...repo, required: true },
        { ...paper, required: true },
      ],
      { name: 'to', value: '<tag>' },
      { name: 'files-only' },
      yes,
    ],
    summary: 'move a paper repo to a newer engine version, as a pull request',
    docs: DOCS.upgrade,
  },
  validate: {
    name: 'validate',
    flags: [
      paper,
      instance,
      typstTemplate,
      { name: 'strict' },
      { name: 'report', value: '<path>' },
      repo,
      { ...baseUrl, hidden: true },
      { ...noSiteTemplate, hidden: true },
    ],
    summary: "run the journal's checks over a manuscript and report what fails",
    docs: DOCS.validate,
  },
  build: {
    name: 'build',
    flags: [
      paper,
      instance,
      baseUrl,
      noSiteTemplate,
      [{ name: 'exports-only' }, { name: 'no-exports' }],
      typstTemplate,
      port,
      serverPort,
      keepHost,
    ],
    summary: "build the paper's website + PDF into _build/",
    docs: DOCS.build,
  },
  start: {
    name: 'start',
    flags: [
      paper,
      instance,
      typstTemplate,
      port,
      serverPort,
      { name: 'template', value: '<path>' },
      { name: 'headless' },
      keepHost,
      { ...baseUrl, hidden: true },
      { ...noSiteTemplate, hidden: true },
    ],
    summary:
      "run mystmd's live preview of the paper, with the journal's settings and branding applied (the same config its CI builds). Reloads as you edit; Ctrl-C stops it. Run in the journal repo, it previews the journal website instead.",
    docs: DOCS.start,
  },
  release: {
    name: 'release',
    positionals: ['<vX.Y.Z>'],
    flags: [
      repo,
      sandbox,
      yes,
      publish,
      instance,
      siteUrl,
      { ...token, hidden: true },
      { name: 'tag', value: '<vX.Y.Z>', hidden: true },
      { name: 'use-local-build', hidden: true },
    ],
    summary:
      "publish a version: reserve and merge the DOI if needed, tag, wait for the Deposit version build, fill the Zenodo draft with it, attach the files to the tag's GitHub release, comment on the commit. Rerun it to continue.",
    docs: DOCS.release,
  },
  releaseStatus: {
    name: 'release status',
    flags: [
      repo,
      sandbox,
      siteUrl,
      instance,
      { ...token, hidden: true },
      { ...paper, hidden: true },
      myst,
    ],
    summary: "the deposit's state on Zenodo",
    docs: DOCS.releaseStatus,
  },
  releaseReserveDoi: {
    name: 'release reserve-doi',
    flags: [
      sandbox,
      repo,
      siteUrl,
      instance,
      { ...token, hidden: true },
      { ...paper, hidden: true },
      myst,
    ],
    summary: 'reserve the DOI on Zenodo and open the pull request writing it into myst.yml',
    docs: DOCS.releaseReserveDoi,
  },
  releaseDeposit: {
    name: 'release deposit',
    flags: [
      { name: 'tag', value: '<vX.Y.Z>', required: true },
      paper,
      { name: 'use-local-build' },
      publish,
      token,
      siteUrl,
      { name: 'bundle-out', value: '<dir>' },
      { ...instance[0], hidden: true },
      { ...instance[1], hidden: true },
      { ...repo, hidden: true },
      myst,
    ],
    summary:
      "deposit the tag's build, in a clone at the tag; --use-local-build deposits its _build",
    docs: DOCS.releaseDeposit,
  },
  clean: {
    name: 'clean',
    flags: [{ name: 'cache' }, yes],
    summary:
      'remove the folders oak release left in the temporary folder; --cache also removes the pinned oak versions in ~/.cache/oak',
    docs: DOCS.clean,
  },
  postChecks: {
    name: 'post-checks',
    flags: [
      { name: 'report', value: '<path>', required: true },
      { ...repo, required: true },
      { name: 'sha', value: '<headsha>', required: true },
      { name: 'base', value: '<branch>', required: true },
      { name: 'verified-head', value: '<headsha>', required: true },
      { ...paper, hidden: true },
    ],
    summary: "post a validate report as the pull request's Check Run and comment",
    docs: DOCS.postChecks,
  },
  deployPreview: {
    name: 'deploy-preview',
    positionals: ['<site>'],
    flags: [
      { name: 'verified-head', value: '<headsha>' },
      instance,
      repo,
      { ...paper, hidden: true },
    ],
    summary: "deploy a pull request's website build as a preview and comment its link",
    docs: DOCS.deployPreview,
  },
  conformanceReset: {
    name: 'conformance reset',
    flags: [{ ...repo, required: true }],
    summary: 'remove what earlier conformance runs left on the test repo',
    docs: DOCS.conformance,
  },
  conformanceRun: {
    name: 'conformance run',
    flags: [
      { ...repo, required: true },
      { name: 'tag', value: '<vX.Y.Z>', required: true },
      { name: 'fork-repo', value: '<owner/name>' },
      { name: 'run-id', value: '<id>' },
      { name: 'record', value: '<path>' },
    ],
    summary: 'test a release on GitHub, on the conformance repos',
    docs: DOCS.conformance,
  },
} as const satisfies Record<string, Command>;

export type CommandKey = keyof typeof COMMANDS;
