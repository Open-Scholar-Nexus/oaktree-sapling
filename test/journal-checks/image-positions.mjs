// One result per image, at `paper.positionOf(image)`, and one for a node it made itself.
export default {
  validate(paper) {
    const page = paper.pages[0];
    const images = paper.selectAll('image', page.mdast);
    return [...images, { type: 'image', url: 'made' }].map((image) => ({
      status: 'fail',
      message: image.url,
      file: page.file,
      position: paper.positionOf(image),
    }));
  },
};
