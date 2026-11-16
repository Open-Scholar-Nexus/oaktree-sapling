/**
 * A code block that stays in view while the paragraphs beside it highlight its lines:
 *
 *   ::::{scroll-code}
 *   ```yaml
 *   ...
 *   ```
 *
 *   :::{scroll-step} 23-26
 *   Lines 23 to 26 list ...
 *   :::
 *
 *   :::{scroll-step} 11-22, 27-31
 *   oak adds the rest.
 *   :::
 *   ::::
 *
 * Each step gets a copy of the code block with its lines emphasized, stacked over the plain one. The rest is CSS, in
 * brand/site.css: each step is a view timeline, and its copy shows once the step reaches the reading line and stays
 * shown after, so the copy of the latest step reached is on top. `timeline-scope` on the block lets a copy follow a
 * step that is not its parent. Narrow screens and browsers without scroll-driven animations get the plain block and
 * the paragraphs in order.
 */

// Line numbers in a `3, 7-9` list; undefined if the list is malformed.
function parse(list) {
  const lines = [];
  for (const part of list.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m || +m[1] > +(m[2] ?? m[1])) return;
    for (let i = +m[1]; i <= +(m[2] ?? m[1]); i++) lines.push(i);
  }
  return lines;
}

function build(node, file) {
  const fail = (message, at) => (file.message(message, at).fatal = true);
  const code = node.children.find((c) => c.type === 'code');
  if (!code) return fail('{scroll-code} needs a code block', node);
  const steps = node.children.filter((c) => c !== code);
  const first = code.startingLineNumber ?? 1;
  const last = first + code.value.split('\n').length - 1;
  const copies = steps.map((step, k) => {
    const lines = step.lines ? parse(step.lines) : [];
    if (!lines || lines.some((i) => i < first || i > last)) {
      fail(`{scroll-step} lines "${step.lines}" are not a list of lines ${first} to ${last}, such as "3, 7-9"`, step);
    }
    step.style = { viewTimelineName: `--step-${k}` };
    delete step.lines;
    const { identifier, label, html_id, ...copy } = structuredClone(code);
    copy.emphasizeLines = lines;
    return { type: 'div', style: { animationTimeline: `--step-${k}` }, children: [copy] };
  });
  node.style = { timelineScope: steps.map((_, k) => `--step-${k}`).join() };
  node.children = [
    { type: 'div', class: 'scroll-code-src', children: [{ type: 'div', children: [code] }, ...copies] },
    { type: 'div', class: 'scroll-code-steps', children: steps },
  ];
}

function walk(node, file) {
  if (node.type === 'div' && node.class?.startsWith('scroll-code ')) build(node, file);
  else node.children?.forEach((c) => walk(c, file));
}

export default {
  name: 'Scroll code',
  directives: [
    {
      name: 'scroll-code',
      doc: 'A code block that stays in view while the {scroll-step} paragraphs after it highlight its lines.',
      body: { type: 'myst', required: true },
      run: (data) => [{ type: 'div', class: 'scroll-code col-page-right', children: data.body }],
    },
    {
      name: 'scroll-step',
      doc: 'One paragraph of a {scroll-code}; the argument lists the lines it highlights, such as "3, 7-9".',
      arg: { type: String },
      body: { type: 'myst', required: true },
      run: (data) => [{ type: 'div', class: 'scroll-code-step', lines: data.arg, children: data.body }],
    },
  ],
  transforms: [
    {
      name: 'scroll-code',
      doc: 'Map each {scroll-step} to the lines of the code block it highlights.',
      stage: 'document',
      plugin: () => (tree, file) => walk(tree, file),
    },
  ],
};
