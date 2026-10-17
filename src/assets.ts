/**
 * Assets matched to the oak version. compose adds them, so papers and journals never carry them
 * [design §6] [design §7].
 */
import { join } from 'node:path';

/** The myst-theme fork release this oak version uses, until upstream book-theme supports the
 *  colours we need. Bump with a release. */
export const THEME_REPO = 'impact-scholars/myst-theme';
export const THEME_VERSION = 'v0.2.0';

/**
 * Where the docs are published. Everything else names a page in `docs-links.ts`. A printed or
 * seeded URL outlives the oak version that wrote it, so pages and their labels must keep
 * resolving. No trailing slash.
 */
export const DOCS_BASE = 'https://scholar.nexus/oaktree-sapling';

/** oak's own typst template, shipped in its checkout, its release tags and its npm package. */
export function engineTypstTemplate(engineRoot: string): string {
  return join(engineRoot, 'templates', 'typst');
}

/** The book-theme zip of the pinned fork release. */
export function themeZipUrl(
  themeRepo: string = THEME_REPO,
  themeVersion: string = THEME_VERSION,
): string {
  return `https://github.com/${themeRepo}/releases/download/${themeVersion}/book-theme.zip`;
}
