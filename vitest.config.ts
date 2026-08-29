import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Vitest 4 / Vite 6 default to oxc as the transformer. oxc honors the
  // tsconfig `jsx` field literally — our Next.js-required `jsx: 'preserve'`
  // makes oxc leave JSX untouched, which then breaks vite's import-analysis
  // with "Failed to parse source for import analysis". Force the
  // automatic-runtime transform explicitly so JSX → JS conversion happens
  // before vite parses the file.
  oxc: {
    jsx: 'automatic',
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    // Live MySQL is shared across tests. The scheduler/refresh tests queue
    // jobs into the shared refresh_jobs table, and other tests' beforeEach
    // scopes cleanup to their own TEST_OWNER — but two test files running in
    // parallel can race on shared rows. Disable file parallelism for now.
    // Future: per-test-file DB sandboxing (M8 or later).
    fileParallelism: false,
  },
});
