// MyST reads an Abstract section as the abstract only when nothing else sets one; with both, the section stays in the body.
export default {
  validate(paper) {
    // MyST moves a frontmatter `abstract:` to `parts.abstract`, in myst.yml's project or in the page that set it.
    const setElsewhere =
      Boolean(paper.project.parts?.abstract) ||
      paper.pages.some(
        (page) =>
          Boolean(page.frontmatter.parts?.abstract) ||
          paper.selectAll('block', page.mdast).some((b) => b.data?.part === 'abstract'),
      );
    const headings = paper.pages.flatMap((page) =>
      paper
        .selectAll('heading', page.mdast)
        .filter((h) => paper.toText(h).trim().toLowerCase() === 'abstract')
        .map((h) => ({ page, h })),
    );
    if (!setElsewhere || headings.length === 0) {
      return { status: 'pass', message: 'The abstract is set once' };
    }
    return headings.map(({ page, h }) => ({
      status: 'fail',
      message: 'The abstract is set here and in the frontmatter or an abstract part',
      help: 'Keep one: remove this section, or the other abstract',
      file: page.file,
      position: h.position,
    }));
  },
};
