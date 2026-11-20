// Waits forever, as a check waiting on a request that never answers does.
export default {
  validate() {
    return new Promise(() => {});
  },
};
