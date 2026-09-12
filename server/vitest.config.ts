import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // Measured 2026-09-12 (wave-8 tail, 416 tests): 80.66 lines /
      // 80.66 statements / 86.12 functions / 76.49 branches. Thresholds sit
      // a few points under reality — raise them as coverage grows, never
      // lower them to force a green run.
      thresholds: {
        lines: 78,
        statements: 78,
        functions: 84,
        branches: 74,
      },
    },
  },
});
