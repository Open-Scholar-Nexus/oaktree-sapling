/**
 * A card whose `:link:` names a heading on another page (`page.md#label`) links straight to it, with no hover preview.
 * MyST resolves such a link by turning the card node into a cross-reference, whose renderer adds the preview.
 */
function walk(node, fn) {
  fn(node);
  node.children?.forEach((child) => walk(child, fn));
}

function markLinkedCards(tree) {
  walk(tree, (node) => {
    if (node.type === 'card' && node.url) node.linkedCard = true;
  });
}

function restoreLinkedCards(tree) {
  walk(tree, (node) => {
    if (node.type !== 'crossReference' || !node.linkedCard) return;
    const url = node.html_id ? `${node.url}#${node.html_id}` : node.url;
    for (const key of Object.keys(node)) {
      if (!['children', 'position', 'key'].includes(key)) delete node[key];
    }
    Object.assign(node, { type: 'card', url });
  });
}

export default {
  name: 'Card links',
  transforms: [
    {
      name: 'card-links-mark',
      doc: 'Mark cards that have a link, before MyST resolves it.',
      stage: 'document',
      plugin: () => (tree) => markLinkedCards(tree),
    },
    {
      name: 'card-links-restore',
      doc: 'Turn a resolved card link back into a card linking to the target.',
      stage: 'project',
      plugin: () => (tree) => restoreLinkedCards(tree),
    },
  ],
};
