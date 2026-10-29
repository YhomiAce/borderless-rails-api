import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so decorator metadata is emitted; Nest DI depends on it.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
