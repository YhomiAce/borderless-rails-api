import { existsSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Resolved from the working directory (the project root locally, /app in the container).
export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');

// Arbitrary constant; serialises migrations when several processes (api, worker) boot at once.
const MIGRATION_LOCK_ID = 727_001;

export async function runMigrations(pool: Pool): Promise<void> {
  if (!existsSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'))) {
    return; // no migrations generated yet
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
