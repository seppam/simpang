import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration test files share (and wipe) the simpang_test database, so run files one at a time.
    fileParallelism: false,
  },
});
