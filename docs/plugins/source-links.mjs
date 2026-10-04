/**
 * Rewrites `[text](src:path#L10-L20)` to a GitHub link at a release tag, which MyST then shows
 * with a preview of those lines. Bump REF when a page describes code newer than it, and
 * recheck the line ranges the pages cite.
 */
const REPO = 'pollomarzo/whitelabel';
const REF = 'v0.0.5';

const SCHEME = 'src:';

function rewrite(node, file) {
  if (node.type === 'link' && typeof node.url === 'string' && node.url.startsWith(SCHEME)) {
    const path = node.url.slice(SCHEME.length);
    if (!path || path.startsWith('/')) {
      file.message(`source link '${node.url}' needs a repository-relative path`, node);
      return;
    }
    node.url = `https://github.com/${REPO}/blob/${REF}/${path}`;
    node.urlSource = node.url;
  }
  node.children?.forEach((c) => rewrite(c, file));
}

export default {
  name: 'Source links',
  transforms: [
    {
      name: 'source-links',
      doc: 'Resolve src: links to the engine source at the pinned ref.',
      // Before MyST's own link transforms, so they see the GitHub URL.
      stage: 'document',
      plugin: () => (tree, file) => rewrite(tree, file),
    },
  ],
};
