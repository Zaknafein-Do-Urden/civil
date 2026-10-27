import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { testTimeout: 120000, include: ['tests/**/*.test.ts'] },
});
