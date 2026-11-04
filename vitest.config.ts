import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only this repo's tests (not copies inside tool worktrees under .claude/).
    include: ['test/**/*.test.ts'],
    // Integration test files share (and wipe) the simpang_test database, so run files one at a time.
    fileParallelism: false,
  },
});
