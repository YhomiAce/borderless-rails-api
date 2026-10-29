import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDatabase } from '../setup/db';

/** Guards enforced by the database itself, independent of application code. */
describe('wallets and balances constraints', () => {
  const { pool } = createTestDb();

  beforeEach(() => resetDatabase(pool));
  afterAll(() => pool.end());

  async function insertUserWallet(email: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO wallets (email) VALUES ($1) RETURNING id`,
      [email],
    );
    return rows[0]!.id;
  }

  it('rejects a negative user balance', async () => {
    const walletId = await insertUserWallet('neg@example.com');
    await pool.query(
      `INSERT INTO balances (wallet_id, currency, kind) VALUES ($1, 'USDx', 'USER')`,
      [walletId],
    );

    await expect(
      pool.query(`UPDATE balances SET amount = -1 WHERE wallet_id = $1`, [walletId]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'balances_non_negative_check' });
  });

  it('allows system balances to go negative', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO wallets (kind) VALUES ('SYSTEM') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO balances (wallet_id, currency, kind, amount) VALUES ($1, 'cNGN', 'SYSTEM', -100)`,
      [rows[0]!.id],
    );
  });

  it('prevents a balance row from claiming a different kind than its wallet', async () => {
    const walletId = await insertUserWallet('kind@example.com');
    await expect(
      pool.query(`INSERT INTO balances (wallet_id, currency, kind) VALUES ($1, 'USDx', 'SYSTEM')`, [
        walletId,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('requires an email or phone for user wallets', async () => {
    await expect(pool.query(`INSERT INTO wallets DEFAULT VALUES`)).rejects.toMatchObject({
      code: '23514',
      constraint: 'wallets_identifier_check',
    });
  });
});
