/**
 * Rewrites a `src:` link to the engine source on GitHub, which MyST then shows with a preview of
 * the linked lines. The target is one of:
 *
 *   src:path                  the file
 *   src:path#L10-L20          those lines
 *   src:path@name             the declaration of `name` in a code file, with its JSDoc
 *   <src:path@"some text">    the first line holding the text: a whole `it(`/`describe(` call in a
 *                             code file, the whole item or block in YAML, else that one line
 *
 * Lines are found in the files on disk, so links point at the commit being built: GITHUB_SHA in
 * CI, else main. A name or text that is not found, or a name declared more than once, fails the
 * build. A target with spaces must sit in angle brackets, or Markdown does not read it as a link.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Open-Scholar-Nexus/oaktree-sapling';
const REF = process.env.GITHUB_SHA || 'main';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const SCHEME = 'src:';
const CODE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const YAML = new Set(['.yml', '.yaml']);
const CLOSER = { '(': ')', '[': ']', '{': '}' };

const regexQuote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indent = (line) => line.length - line.trimStart().length;

/**
 * The last line of the statement starting at line `from`: where a bracket closes back to the
 * starting depth with at most `;` or `,` after it and no continuation on the next line, a `;` (or
 * a `,` when `comma`) at that depth, or the line before a bracket that closes past it. Strings,
 * templates, regex literals and comments are skipped.
 */
export function statementEnd(lines, from, comma = false) {
  const stack = [];
  let prev = '';
  const continues = (l) => /^\s*[.?:+&|=]/.test(lines.slice(l + 1).find((x) => x.trim()) ?? '');
  for (let l = from; l < lines.length; l++) {
    const line = lines[l];
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const top = stack[stack.length - 1];
      if (top === '`') {
        if (c === '\\') i++;
        else if (c === '`') stack.pop();
        else if (c === '$' && line[i + 1] === '{') stack.push('}'), i++;
        continue;
      }
      if (top === '*/') {
        if (c === '*' && line[i + 1] === '/') stack.pop(), i++;
        continue;
      }
      if (/\s/.test(c)) continue;
      if (c === '/' && line[i + 1] === '/') break;
      if (c === '/' && line[i + 1] === '*') {
        stack.push('*/'), i++;
        continue;
      }
      if (c === '/' && (/[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || !prev || /\breturn$/.test(line.slice(0, i).trimEnd()))) {
        for (let cls = false, j = i + 1; j < line.length; j++) {
          if (line[j] === '\\') j++;
          else if (line[j] === '[') cls = true;
          else if (line[j] === ']') cls = false;
          else if (line[j] === '/' && !cls) {
            i = j;
            break;
          }
        }
        prev = '/';
        continue;
      }
      prev = c;
      if (c === "'" || c === '"') {
        for (i++; i < line.length && line[i] !== c; i++) if (line[i] === '\\') i++;
        continue;
      }
      if (c === '`') stack.push('`');
      else if (CLOSER[c]) stack.push(CLOSER[c]);
      else if (c === ')' || c === ']' || c === '}') {
        if (!stack.length) return line.slice(0, i).trim() ? l : l - 1;
        stack.pop();
        if (!stack.length && /^[;,]?\s*$/.test(line.slice(i + 1)) && !continues(l)) return l;
      } else if (!stack.length && (c === ';' || (comma && c === ','))) return l;
    }
  }
  return lines.length - 1;
}

/** The 0-based first and last line of `name`'s declaration in `source`, or an error string. */
export function findSymbol(source, name) {
  if (!/^[\w$]+$/.test(name)) return `'${name}' is not a name; quote text to search for it`;
  const n = regexQuote(name);
  const declaration = new RegExp(
    String.raw`^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?` +
      String.raw`(function\*?|const|let|var|class|interface|type|enum|namespace)\s+${n}(?![\w$])`,
  );
  const key = new RegExp(String.raw`^\s*(['"]?)${n}\1\??\s*:`);
  const method = new RegExp(
    String.raw`^\s*((static|async|get|set|public|private|protected|readonly|override)\s+)*\*?${n}\s*[<(].*\{$`,
  );
  const lines = source.split('\n');
  const matching = (test) => lines.flatMap((line, i) => (test(line) ? [i] : []));
  // A declaration keyword outranks a key, so an interface field never shadows its function.
  let found = matching((line) => declaration.test(line));
  const member = !found.length;
  if (member) found = matching((line) => key.test(line) || method.test(line));
  if (!found.length) return `no declaration of '${name}'`;
  if (found.length > 1) return `'${name}' is declared on lines ${found.map((i) => i + 1).join(', ')}`;
  const [at] = found;
  let start = at;
  if (lines[at - 1]?.trim().endsWith('*/')) {
    let j = at - 1;
    while (j > 0 && !lines[j].trim().startsWith('/*')) j--;
    if (lines[j].trim().startsWith('/**')) start = j;
  }
  return [start, statementEnd(lines, at, member)];
}

/** The 0-based lines of the YAML item or block holding line `at`, with the comments above it, else `at` alone. */
export function yamlBlock(lines, at) {
  let start = at;
  const own = indent(lines[at]);
  if (!lines[at].trimStart().startsWith('- ')) {
    for (let j = at - 1; j >= 0; j--) {
      if (!lines[j].trim()) continue;
      const d = indent(lines[j]);
      if (d >= own) continue;
      if (lines[j].trimStart().startsWith('- ') && d + 2 === own) start = j;
      break;
    }
  }
  const depth = indent(lines[start]);
  let end = start;
  for (let j = start + 1; j < lines.length; j++) {
    if (!lines[j].trim()) continue;
    if (indent(lines[j]) <= depth) break;
    end = j;
  }
  while (start > 0 && lines[start - 1].trimStart().startsWith('#') && indent(lines[start - 1]) === depth) start--;
  return end > at || start < at ? [start, end] : [at, at];
}

/** The 0-based lines `text` links to in the file at `path`, or an error string. */
export function findText(source, text, path) {
  const lines = source.split('\n');
  const at = lines.findIndex((line) => line.includes(text));
  if (at < 0) return `no line contains "${text}"`;
  const ext = extname(path);
  if (CODE.has(ext) && /^\s*(it|test|describe)(\.\w+)*\s*\(/.test(lines[at])) return [at, statementEnd(lines, at)];
  if (YAML.has(ext)) return yamlBlock(lines, at);
  return [at, at];
}

/** The GitHub URL for a `src:` link's URL, or `{ error }`. */
export function resolve(target, read = (p) => readFileSync(ROOT + p, 'utf8')) {
  let spec;
  try {
    spec = decodeURIComponent(target.slice(SCHEME.length));
  } catch {
    return { error: `${target.slice(SCHEME.length)} is not a valid URL` };
  }
  const at = spec.indexOf('@');
  const path = at < 0 ? spec : spec.slice(0, at);
  if (!path || path.startsWith('/')) return { error: `${spec} needs a repository-relative path` };
  const base = `https://github.com/${REPO}/blob/${REF}/`;
  if (at < 0) return { url: base + target.slice(SCHEME.length) };
  const query = spec.slice(at + 1);
  let source;
  try {
    source = read(path);
  } catch {
    return { error: `${spec}: no file at ${path}` };
  }
  const quoted = /^"(.+)"$/.exec(query);
  let range;
  if (quoted) range = findText(source, quoted[1], path);
  else if (CODE.has(extname(path))) range = findSymbol(source, query);
  else range = `a name works only in a code file; quote text to search for it`;
  if (typeof range === 'string') return { error: `${spec}: ${range}` };
  const [a, b] = range.map((i) => i + 1);
  return { url: `${base}${path}#L${a}${b > a ? `-L${b}` : ''}` };
}

// A fatal message is an error, which stops a --strict build; a plain one is only a warning.
function fail(file, node, text) {
  file.message(text, node).fatal = true;
}

function rewrite(node, file) {
  if (node.type === 'text' && node.value.includes('](src:')) {
    fail(file, node, `'${node.value.trim()}' did not parse as a link; put a target with spaces in <>`);
  }
  if (node.type === 'link' && typeof node.url === 'string' && node.url.startsWith(SCHEME)) {
    const { url, error } = resolve(node.url);
    if (error) {
      fail(file, node, `source link ${SCHEME}${error}`);
      return;
    }
    node.url = url;
    node.urlSource = url;
  }
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
