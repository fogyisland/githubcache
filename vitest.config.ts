import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Live MySQL is shared across tests. The scheduler/refresh tests queue
    // jobs into the shared refresh_jobs table, and other tests' beforeEach
    // scopes cleanup to their own TEST_OWNER — but two test files running in
    // parallel can race on shared rows. Disable file parallelism for now.
    // Future: per-test-file DB sandboxing (M8 or later).
    fileParallelism: false,
  },
});
