import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests share one database, so they must not run concurrently.
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
