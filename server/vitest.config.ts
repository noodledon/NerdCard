import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // Only measure shipped source — gitignored local probe drivers
      // (server/*.mjs: qa-runner, *-probe, playmatch) live in the main
      // checkout's package root and must not drag the gate.
      include: ['src/**'],
      // Measured 2026-09-12 (wave-12 T3, 559 tests): 90.93 lines /
      // 90.93 statements / 89.55 functions / 82.14 branches. Thresholds sit
      // at the measured floor rounded down — raise them as coverage grows,
      // never lower them to force a green run.
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 89,
        branches: 82,
      },
    },
  },
});
