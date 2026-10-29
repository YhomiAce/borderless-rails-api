import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { transactions } from '../../src/database/schema';
import { DbTransaction } from '../../src/database/types';
import { Currency } from '../../src/domain/currency';
import { InsufficientFundsError } from '../../src/modules/ledger/ledger.errors';
import { LedgerLine, LedgerService } from '../../src/modules/ledger/ledger.service';
import { createTestDb, resetDatabase } from '../setup/db';
import { expectLedgerInvariants } from '../setup/invariants';

describe('LedgerService', () => {
  const { pool, db } = createTestDb();
  const ledger = new LedgerService();
  let mint: string;

  async function createWallet(kind: 'USER' | 'SYSTEM' = 'USER'): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO wallets (kind, email) VALUES ($1, $2) RETURNING id`,
      [kind, kind === 'USER' ? `${randomUUID()}@example.com` : null],
    );
    const id = rows[0]!.id;
    await pool.query(
      `INSERT INTO balances (wallet_id, currency, kind)
       SELECT $1, c, $2 FROM unnest(enum_range(NULL::currency)) AS c`,
      [id, kind],
    );
    return id;
  }

  async function insertTransaction(tx: DbTransaction, walletId: string): Promise<string> {
    const [row] = await tx
      .insert(transactions)
      .values({
        type: 'DEPOSIT',
        walletId,
        sourceCurrency: 'USDx',
        sourceAmount: 1n,
        destinationCurrency: 'USDx',
        destinationAmount: 1n,
        rate: '1',
        rateSource: 'identity',
        idempotencyKey: randomUUID(),
      })
      .returning({ id: transactions.id });
    return row!.id;
  }

  /** Posts lines in their own DB transaction, as a service would. */
  function post(initiator: string, lines: LedgerLine[]) {
    return db.transaction(async (tx) =>
      ledger.post(tx, await insertTransaction(tx, initiator), lines),
    );
  }

  const move = (from: string, to: string, currency: Currency, amount: bigint): LedgerLine[] => [
    { walletId: from, currency, amount: -amount },
    { walletId: to, currency, amount },
  ];

  async function balanceOf(walletId: string, currency: Currency): Promise<bigint> {
    const { rows } = await pool.query<{ amount: string }>(
      `SELECT amount FROM balances WHERE wallet_id = $1 AND currency = $2`,
      [walletId, currency],
    );
    return BigInt(rows[0]!.amount);
  }

  beforeEach(async () => {
    await resetDatabase(pool);
    mint = await createWallet('SYSTEM');
  });
  afterAll(() => pool.end());

  it('moves money and records signed lines with running balances', async () => {
    const alice = await createWallet();
    const posted = await post(alice, move(mint, alice, 'USDx', 100n));

    expect(posted).toEqual([
      { walletId: mint, currency: 'USDx', amount: -100n, balanceAfter: -100n },
      { walletId: alice, currency: 'USDx', amount: 100n, balanceAfter: 100n },
    ]);
    expect(await balanceOf(alice, 'USDx')).toBe(100n);
    await expectLedgerInvariants(pool);
  });

  it('rejects a debit beyond the balance and leaves everything unchanged', async () => {
    const alice = await createWallet();
    const bob = await createWallet();
    await post(alice, move(mint, alice, 'cNGN', 50n));

    await expect(post(alice, move(alice, bob, 'cNGN', 51n))).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
    expect(await balanceOf(alice, 'cNGN')).toBe(50n);
    expect(await balanceOf(bob, 'cNGN')).toBe(0n);
    await expectLedgerInvariants(pool);
  });

  it('refuses unbalanced postings', async () => {
    const alice = await createWallet();
    await expect(post(alice, [{ walletId: alice, currency: 'USDx', amount: 5n }])).rejects.toThrow(
      /Unbalanced/,
    );
  });

  it('never overspends under concurrent debits', async () => {
    const alice = await createWallet();
    const bob = await createWallet();
    await post(alice, move(mint, alice, 'USDx', 100n));

    // 20 concurrent debits of 10 against a balance of 100: exactly 10 can succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => post(alice, move(alice, bob, 'USDx', 10n))),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toBe(10);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    expect(await balanceOf(alice, 'USDx')).toBe(0n);
    expect(await balanceOf(bob, 'USDx')).toBe(100n);
    await expectLedgerInvariants(pool);
  });

  it('does not deadlock when transfers run in opposite directions', async () => {
    const alice = await createWallet();
    const bob = await createWallet();
    await post(alice, move(mint, alice, 'cGHS', 1_000n));
    await post(bob, move(mint, bob, 'cGHS', 1_000n));

    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        i % 2 === 0
          ? post(alice, move(alice, bob, 'cGHS', 7n))
          : post(bob, move(bob, alice, 'cGHS', 7n)),
      ),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect((await balanceOf(alice, 'cGHS')) + (await balanceOf(bob, 'cGHS'))).toBe(2_000n);
    await expectLedgerInvariants(pool);
  });
});
