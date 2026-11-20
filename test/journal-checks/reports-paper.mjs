// Reports what it reads from `paper` as JSON in its message, so a test can compare it.
const texts = (parts, toText) =>
  Object.fromEntries(Object.entries(parts).map(([name, tree]) => [name, toText(tree).trim()]));

export default {
  validate(paper) {
    const [index] = paper.pages;
    const seen = {
      projectParts: texts(paper.projectParts, paper.toText),
      pageParts: texts(index.parts, paper.toText),
      pageKeys: Object.keys(index.frontmatter).sort(),
      fileFrontmatter: index.fileFrontmatter,
      configTitle: paper.config.project?.title,
    };
    return { status: 'pass', message: JSON.stringify(seen) };
  },
};
