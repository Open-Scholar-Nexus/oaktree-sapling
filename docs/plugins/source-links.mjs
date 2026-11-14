/**
 * Rewrites a `src:` link to the engine source on GitHub, which MyST then shows with a preview:
 *   src:path                the file
 *   src:path#L10-L20        those lines
 *   src:path@name           the line declaring `name`
 *   <src:path@"some text">  the first line holding the text; a target with spaces needs the <>
 *
 * Lines are found in the files on disk, so links point at the commit being built: GITHUB_SHA in
 * CI, else main. A name or text that is not found fails the build.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'Open-Scholar-Nexus/oaktree-sapling';
const REF = process.env.GITHUB_SHA || 'main';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCHEME = 'src:';

/** The 1-based line `query` (a name, or quoted text) points at in `source`, or an error string. */
export function findLine(source, query) {
  const lines = source.split('\n');
  const text = /^"(.+)"$/.exec(query)?.[1];
  if (text) {
    const at = lines.findIndex((line) => line.includes(text));
    return at < 0 ? `no line contains "${text}"` : at + 1;
  }
  const n = query.replace(/\W/g, '\\$&');
  const declaration = new RegExp(`^\\s*(export\\s+)?(async\\s+)?(function|const|let|class|interface|type|enum)\\s+${n}(?![\\w$])`);
  const key = new RegExp(`^\\s*${n}\\s*[:(]`);
  // A declaration keyword outranks a key, so an interface field never shadows its function.
  let at = lines.findIndex((line) => declaration.test(line));
  if (at < 0) at = lines.findIndex((line) => key.test(line));
  return at < 0 ? `no declaration of '${query}'` : at + 1;
}

/** The GitHub URL for a `src:` link's URL, or `{ error }`. */
export function resolve(target, read = (p) => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : undefined)) {
  const spec = decodeURIComponent(target.slice(SCHEME.length));
  const [path, query] = spec.split(/@(.*)/);
  if (!path || path.startsWith('/')) return { error: `${spec} needs a repository-relative path` };
  const url = `https://github.com/${REPO}/blob/${REF}/`;
  if (query === undefined) return { url: url + target.slice(SCHEME.length) };
  const source = read(path);
  if (source === undefined) return { error: `${spec}: no file at ${path}` };
  const line = findLine(source, query);
  return typeof line === 'string' ? { error: `${spec}: ${line}` } : { url: `${url}${path}#L${line}` };
}

function rewrite(node, file) {
  let error;
  if (node.type === 'text' && node.value.includes('](src:')) {
    error = `'${node.value.trim()}' did not parse as a link; put a target with spaces in <>`;
  }
  if (node.type === 'link' && typeof node.url === 'string' && node.url.startsWith(SCHEME)) {
    const resolved = resolve(node.url);
    if (resolved.error) error = `source link ${SCHEME}${resolved.error}`;
    else node.url = node.urlSource = resolved.url;
  }
  // A fatal message is an error, which stops a --strict build; a plain one is only a warning.
  if (error) file.message(error, node).fatal = true;
  node.children?.forEach((c) => rewrite(c, file));
}

export default {
  name: 'Source links',
  transforms: [
    {
      name: 'source-links',
      doc: 'Resolve src: links to the engine source at the commit being built.',
      // Before MyST's own link transforms, so they see the GitHub URL.
      stage: 'document',
      plugin: () => (tree, file) => rewrite(tree, file),
    },
  ],
};
