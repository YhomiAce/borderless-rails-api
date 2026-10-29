import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { balances, ledgerEntries, Transaction } from '../../database/schema';
import { DbTransaction } from '../../database/types';
import { Currency } from '../../domain/currency';
import { formatAmount, Units } from '../../domain/money';
import { OutboxService } from '../events/outbox.service';
import { InsufficientFundsError } from './ledger.errors';

export interface LedgerLine {
  walletId: string;
  currency: Currency;
  /** Signed: debit < 0, credit > 0. */
  amount: Units;
}

export interface PostedLine extends LedgerLine {
  balanceAfter: Units;
}

type LockedBalance = {
  wallet_id: string;
  currency: Currency;
  kind: 'USER' | 'SYSTEM';
  amount: string;
};

const keyOf = (walletId: string, currency: Currency) => `${walletId}:${currency}`;

/**
 * The only code path that moves money. Every deposit, swap and transfer becomes a balanced
 * set of ledger lines posted here, inside the caller's database transaction.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly outbox: OutboxService) {}

  /** Posts the lines and emits wallet.credited / wallet.debited for every user balance change. */
  async post(
    tx: DbTransaction,
    transaction: Pick<Transaction, 'id' | 'type'>,
    lines: LedgerLine[],
  ): Promise<PostedLine[]> {
    assertBalanced(lines);

    // Lock every affected balance row, always in the same order (wallet, currency), so two
    // postings touching the same rows (e.g. A→B and B→A) queue up instead of deadlocking.
    const keys = [...new Map(lines.map((l) => [keyOf(l.walletId, l.currency), l])).values()].sort(
      (a, b) =>
        a.walletId === b.walletId
          ? a.currency.localeCompare(b.currency)
          : a.walletId.localeCompare(b.walletId),
    );
    const { rows } = await tx.execute<LockedBalance>(sql`
      SELECT wallet_id, currency, kind, amount
      FROM balances
      WHERE (wallet_id, currency) IN (${sql.join(
        keys.map((k) => sql`(${k.walletId}::uuid, ${k.currency}::currency)`),
        sql`, `,
      )})
      ORDER BY wallet_id, currency
      FOR UPDATE
    `);

    const locked = new Map(rows.map((r) => [keyOf(r.wallet_id, r.currency), r]));
    const running = new Map<string, Units>();
    for (const k of keys) {
      const row = locked.get(keyOf(k.walletId, k.currency));
      if (!row) throw new Error(`No balance row for ${k.walletId} ${k.currency}`);
      running.set(keyOf(k.walletId, k.currency), BigInt(row.amount));
    }

    // Funds are checked only after the locks are held, so the check can't go stale.
    const posted: PostedLine[] = lines.map((line) => {
      const key = keyOf(line.walletId, line.currency);
      const balanceAfter = running.get(key)! + line.amount;
      running.set(key, balanceAfter);
      return { ...line, balanceAfter };
    });
    for (const k of keys) {
      const key = keyOf(k.walletId, k.currency);
      const row = locked.get(key)!;
      const final = running.get(key)!;
      if (row.kind === 'USER' && final < 0n) {
        const available = BigInt(row.amount);
        throw new InsufficientFundsError(k.currency, available, available - final);
      }
    }

    for (const k of keys) {
      await tx
        .update(balances)
        .set({ amount: running.get(keyOf(k.walletId, k.currency))!, updatedAt: new Date() })
        .where(and(eq(balances.walletId, k.walletId), eq(balances.currency, k.currency)));
    }
    await tx.insert(ledgerEntries).values(
      posted.map((p) => ({
        transactionId: transaction.id,
        walletId: p.walletId,
        currency: p.currency,
        amount: p.amount,
        balanceAfter: p.balanceAfter,
      })),
    );

    await this.outbox.record(
      tx,
      posted
        .filter((p) => locked.get(keyOf(p.walletId, p.currency))!.kind === 'USER')
        .map((p) => ({
          type: p.amount > 0n ? ('wallet.credited' as const) : ('wallet.debited' as const),
          aggregateId: p.walletId,
          data: {
            walletId: p.walletId,
            currency: p.currency,
            amount: formatAmount(p.amount > 0n ? p.amount : -p.amount, p.currency),
            balanceAfter: formatAmount(p.balanceAfter, p.currency),
            transactionId: transaction.id,
            transactionType: transaction.type,
          },
        })),
    );

    return posted;
  }
}

/** Money is never created or destroyed: lines must net to zero in every currency. */
function assertBalanced(lines: LedgerLine[]): void {
  if (lines.length === 0) throw new Error('A posting needs at least one line');
  const totals = new Map<Currency, Units>();
  for (const line of lines) {
    if (line.amount === 0n) throw new Error('Ledger lines must be non-zero');
    totals.set(line.currency, (totals.get(line.currency) ?? 0n) + line.amount);
  }
  for (const [currency, total] of totals) {
    if (total !== 0n) throw new Error(`Unbalanced posting: ${currency} nets to ${total}`);
  }
}
