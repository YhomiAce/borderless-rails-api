import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nest DI resolves constructor dependencies from decorator metadata, so Oxc must emit it.
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
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
          globalSetup: ['test/setup/global-setup.ts'],
          setupFiles: ['test/setup/integration-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
