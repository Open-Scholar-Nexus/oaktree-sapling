// Returns `options.result`, so a test can choose what a check file returns.
export default {
  validate(paper, options) {
    return options.result;
  },
};
