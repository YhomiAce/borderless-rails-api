import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/database/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Starts a throwaway Postgres (or uses TEST_DATABASE_URL when set, e.g. in CI)
 * and applies migrations once for the whole integration run.
 */
export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('borderless_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    databaseUrl = container.getConnectionUri();
  }

  const pool = new Pool({ connectionString: databaseUrl });
  await runMigrations(pool);
  await pool.end();

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await container?.stop();
  };
}
