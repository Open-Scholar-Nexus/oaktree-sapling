// Every author has an ORCID. In the editions `warn_in` names, a missing one is a warning.
export default {
  validate(paper, options) {
    const edition = paper.project.options?.['oaktree-sapling']?.edition;
    const optional = (options.warn_in ?? []).includes(edition);
    const missing = (paper.project.authors ?? []).filter((author) => !author.orcid);
    if (missing.length === 0) return { status: 'pass', message: 'Every author has an ORCID' };
    return missing.map((author) => ({
      status: 'fail',
      message: `${author.name} does not have an ORCID`,
      help: 'Add an orcid to the author in myst.yml',
      optional,
    }));
  },
};
