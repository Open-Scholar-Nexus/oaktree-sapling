export default {
  validate(paper) {
    paper.pages[0].mdast.children = [];
    paper.project.title = 'changed';
    return [];
  },
};
