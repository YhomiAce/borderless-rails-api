import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer } from '@testcontainers/rabbitmq';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/database/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    rabbitmqUrl: string;
  }
}

interface Stoppable {
  stop(): Promise<unknown>;
}

/**
 * Starts throwaway Postgres and RabbitMQ containers (or uses TEST_DATABASE_URL /
 * TEST_RABBITMQ_URL when set, e.g. in CI) and applies migrations once for the whole run.
 */
export default async function setup(project: TestProject) {
  const started: Stoppable[] = [];

  const [databaseUrl, rabbitmqUrl] = await Promise.all([
    process.env.TEST_DATABASE_URL ??
      new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('borderless_test')
        .withUsername('test')
        .withPassword('test')
        .start()
        .then((c) => {
          started.push(c);
          return c.getConnectionUri();
        }),
    process.env.TEST_RABBITMQ_URL ??
      new RabbitMQContainer('rabbitmq:3.13-alpine').start().then((c) => {
        started.push(c);
        return c.getAmqpUrl();
      }),
  ]);

  const pool = new Pool({ connectionString: databaseUrl });
  await runMigrations(pool);
  await pool.end();

  project.provide('databaseUrl', databaseUrl);
  project.provide('rabbitmqUrl', rabbitmqUrl);

  return async () => {
    await Promise.all(started.map((c) => c.stop()));
  };
}
