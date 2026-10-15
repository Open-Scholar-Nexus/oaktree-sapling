import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-teardown.ts'],
    // The runner's own event would make every spawned oak write Stage 2 files; tests set one.
    env: { GITHUB_EVENT_NAME: '', GITHUB_EVENT_PATH: '' },
  },
});
