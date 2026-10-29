import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, or, SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE } from '../../database/database.constants';
import { transactions, wallets } from '../../database/schema';
import { Database } from '../../database/types';
import { Currency } from '../../domain/currency';
import { WalletNotFoundError } from '../wallets/wallets.errors';
import { presentTransaction, TransactionResponse } from './transaction.presenter';
import { InvalidCursorError, TransactionNotFoundError } from './transactions.errors';

export type Direction = 'IN' | 'INTERNAL' | 'SENT' | 'RECEIVED';

export interface HistoryQuery {
  type?: 'DEPOSIT' | 'SWAP' | 'TRANSFER';
  currency?: Currency;
  limit: number;
  cursor?: string;
}

export interface HistoryPage {
  data: (TransactionResponse & { direction: Direction })[];
  pagination: { limit: number; nextCursor: string | null; hasMore: boolean };
}

/** Position of the last row on a page: its exact (microsecond) timestamp and id. */
const cursorSchema = z.object({ t: z.iso.datetime({ precision: 6 }), i: z.uuid() });
type Cursor = z.infer<typeof cursorSchema>;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new InvalidCursorError();
  }
}

// Postgres keeps microseconds; a JS Date would truncate them and break keyset comparisons.
const createdAtText = sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

@Injectable()
export class HistoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Newest first, keyset-paginated on (created_at, id) so pages stay stable as rows are added. */
  async listForWallet(walletId: string, query: HistoryQuery): Promise<HistoryPage> {
    const [wallet] = await this.db
      .select({ id: wallets.id })
      .from(wallets)
      .where(and(eq(wallets.id, walletId), eq(wallets.kind, 'USER')));
    if (!wallet) throw new WalletNotFoundError(walletId);

    const conditions: (SQL | undefined)[] = [
      or(eq(transactions.walletId, walletId), eq(transactions.counterpartyWalletId, walletId)),
      query.type && eq(transactions.type, query.type),
      query.currency &&
        or(
          eq(transactions.sourceCurrency, query.currency),
          eq(transactions.destinationCurrency, query.currency),
        ),
    ];
    if (query.cursor) {
      const { t, i } = decodeCursor(query.cursor);
      conditions.push(
        sql`(${transactions.createdAt}, ${transactions.id}) < (${t}::timestamptz, ${i}::uuid)`,
      );
    }

    const rows = await this.db
      .select({ tx: transactions, createdAtText })
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      data: page.map(({ tx }) => ({
        ...presentTransaction(tx),
        direction: directionFor(tx, walletId),
      })),
      pagination: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor({ t: last.createdAtText, i: last.tx.id }) : null,
      },
    };
  }

  async findById(transactionId: string): Promise<TransactionResponse> {
    const [tx] = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId));
    if (!tx) throw new TransactionNotFoundError(transactionId);
    return presentTransaction(tx);
  }
}

function directionFor(tx: typeof transactions.$inferSelect, walletId: string): Direction {
  if (tx.type === 'DEPOSIT') return 'IN';
  if (tx.type === 'SWAP') return 'INTERNAL';
  return tx.walletId === walletId ? 'SENT' : 'RECEIVED';
}
