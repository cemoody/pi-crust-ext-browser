import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit/contract/widget run everywhere; the real-browser e2e is opt-in
    // (needs Chromium + Xvfb) and is excluded from the default fast suite.
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'node_modules/**'],
    environment: 'node',
  },
});
