import { Pool } from 'pg';
import { expect } from 'vitest';

/**
 * Accounting invariants that must hold after any sequence of operations:
 * 1. every transaction's ledger lines net to zero in each currency;
 * 2. each balance equals the sum of its ledger lines;
 * 3. no user balance is negative.
 */
export async function expectLedgerInvariants(pool: Pool): Promise<void> {
  const unbalanced = await pool.query(`
    SELECT transaction_id, currency, sum(amount) AS net
    FROM ledger_entries GROUP BY transaction_id, currency HAVING sum(amount) <> 0`);
  expect(unbalanced.rows, 'transactions whose lines do not net to zero').toEqual([]);

  const drifted = await pool.query(`
    SELECT b.wallet_id, b.currency, b.amount, coalesce(sum(l.amount), 0) AS ledger_total
    FROM balances b
    LEFT JOIN ledger_entries l ON l.wallet_id = b.wallet_id AND l.currency = b.currency
    GROUP BY b.wallet_id, b.currency, b.amount
    HAVING b.amount <> coalesce(sum(l.amount), 0)`);
  expect(drifted.rows, 'balances that differ from their ledger').toEqual([]);

  const negative = await pool.query(
    `SELECT wallet_id, currency, amount FROM balances WHERE kind = 'USER' AND amount < 0`,
  );
  expect(negative.rows, 'negative user balances').toEqual([]);
}
