// A bold or italic line on its own is a paragraph to MyST: no number, no contents entry, no link target.
export default {
  validate(paper) {
    const found = [];
    for (const page of paper.pages) {
      // Top-level paragraphs only, so a bold caption or table cell is left alone.
      const top = page.mdast.children.flatMap((n) => (n.type === 'block' ? n.children : [n]));
      for (const p of top.filter((n) => n.type === 'paragraph')) {
        const parts = p.children.filter((c) => c.type !== 'text' || c.value.trim());
        if (parts.length === 1 && ['strong', 'emphasis'].includes(parts[0].type)) {
          found.push({
            status: 'fail',
            message: `"${paper.toText(p)}" is styled as a heading`,
            help: 'Make it a heading (## ...) or part of the text',
            file: page.file,
            position: p.position,
          });
        }
      }
    }
    return found.length
      ? found
      : { status: 'pass', message: 'No bold or italic lines used as headings' };
  },
};
