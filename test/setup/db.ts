import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';
import * as schema from '../../src/database/schema';
import { SYSTEM_ACCOUNTS } from '../../src/database/system-accounts';
import type { Database } from '../../src/database/types';

export interface TestDb {
  pool: Pool;
  db: Database;
}

export function createTestDb(): TestDb {
  const pool = new Pool({ connectionString: inject('databaseUrl') });
  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * Returns the database to its freshly-migrated state: empties every table except the
 * migration-seeded system accounts, whose balances go back to zero.
 */
export async function resetDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT IN ('wallets', 'balances')`,
  );
  if (rows.length > 0) {
    await pool.query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  await pool.query(`DELETE FROM wallets WHERE NOT (id = ANY($1::uuid[]))`, [
    Object.values(SYSTEM_ACCOUNTS),
  ]);
  await pool.query(`UPDATE balances SET amount = 0`);
}
