import { defineConfig } from 'vitest/config';

// Real-browser e2e (needs Chromium). Run explicitly:
//   npx vitest run --config vitest.e2e.config.ts
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
