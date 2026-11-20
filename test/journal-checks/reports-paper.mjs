// Reports what it reads from `paper` as JSON in its message, so a test can compare it.
const texts = (parts, toText) =>
  Object.fromEntries(Object.entries(parts).map(([name, tree]) => [name, toText(tree).trim()]));

export default {
  validate(paper) {
    const [index] = paper.pages;
    const [figure] = paper.selectAll('container', index.mdast);
    const seen = {
      figure: figure && {
        own: Boolean(figure.position),
        line: paper.positionOf(figure)?.start.line,
      },
      projectParts: texts(paper.projectParts, paper.toText),
      pageParts: texts(index.parts, paper.toText),
      pageKeys: Object.keys(index.frontmatter).sort(),
      fileFrontmatter: index.fileFrontmatter,
      configTitle: paper.config.project?.title,
      repo: paper.repo,
      journalName: paper.journal?.config.name,
      journalRoot: paper.journal?.root,
      registryIds: paper.journal?.registry.map((e) => e.id),
    };
    return { status: 'pass', message: JSON.stringify(seen) };
  },
};
