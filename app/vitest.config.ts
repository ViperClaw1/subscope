import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true, // ponytail: drop once step 2 lands the first tests
    testTimeout: 15_000, // mock's ready/deleted transitions take ≥1 s each
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
