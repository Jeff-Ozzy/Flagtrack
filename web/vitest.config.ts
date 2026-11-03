import { defineConfig } from 'vitest/config';
import { offlineBackend } from './vite.config';

// Runs the offline backend (server routes + on-device DB) in Node with a simulated IndexedDB.
export default defineConfig({
  plugins: [offlineBackend({ browserLibs: false })],
  define: { 'import.meta.env.VITE_LOCAL': JSON.stringify('true') },
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
