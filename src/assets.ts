/**
 * URLs of assets matched to the oak version. compose adds them, so papers and journals never
 * carry them [design §6] [design §7].
 */

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

/** A typst template zip on the release [R175]. No release attaches one yet; it is only reached
 *  when no `templates/typst` sits beside the build. */
export function typstTemplateUrl(engineRepo: string, engineVersion: string): string {
  return `https://github.com/${engineRepo}/releases/download/${engineVersion}/typst-template.zip`;
}

/** The book-theme zip of the pinned fork release. */
export function themeZipUrl(
  themeRepo: string = THEME_REPO,
  themeVersion: string = THEME_VERSION,
): string {
  return `https://github.com/${themeRepo}/releases/download/${themeVersion}/book-theme.zip`;
}
