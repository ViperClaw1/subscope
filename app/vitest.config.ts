import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000, // mock's ready/deleted transitions take ≥1 s each
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      // branches < lines: the remaining gaps are "op replaced while awaiting" guards after each request
      thresholds: { lines: 95, branches: 85 },
    },
  },
});
