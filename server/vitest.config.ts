import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { DATABASE_URL: 'file:./test.db', NODE_ENV: 'test', JWT_SECRET: 'test-secret' },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
