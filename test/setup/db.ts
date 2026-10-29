import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';
import * as schema from '../../src/database/schema';
import type { Database } from '../../src/database/types';

export interface TestDb {
  pool: Pool;
  db: Database;
}

export function createTestDb(): TestDb {
  const pool = new Pool({ connectionString: inject('databaseUrl') });
  return { pool, db: drizzle(pool, { schema }) };
}

/** Empties every application table so each test starts from a clean state. */
export async function resetDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
