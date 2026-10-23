export default {
  validate(paper) {
    return {
      status: 'pass',
      message: `${paper.pages[0].mdast.children.length} nodes, title ${paper.project.title}`,
    };
  },
};
