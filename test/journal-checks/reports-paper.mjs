// Reports what it reads from `paper` as JSON in its message, so a test can compare it.
const texts = (parts, toText) =>
  Object.fromEntries(Object.entries(parts).map(([name, tree]) => [name, toText(tree).trim()]));

export default {
  validate(paper) {
    const [index] = paper.pages;
    const seen = {
      projectParts: texts(paper.projectParts, paper.toText),
      pageParts: texts(index.parts, paper.toText),
    };
    return { status: 'pass', message: JSON.stringify(seen) };
  },
};
