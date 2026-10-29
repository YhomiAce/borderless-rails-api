import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import { uniqueViolation } from '../../database/pg-errors';
import { balances, wallets } from '../../database/schema';
import { Database } from '../../database/types';
import { CURRENCIES } from '../../domain/currency';
import { WalletWithBalances } from './wallets.presenter';
import { WalletExistsError, WalletNotFoundError } from './wallets.errors';

@Injectable()
export class WalletsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(input: { email?: string; phone?: string }): Promise<WalletWithBalances> {
    try {
      return await this.db.transaction(async (tx) => {
        const [wallet] = await tx
          .insert(wallets)
          .values({ email: input.email ?? null, phone: input.phone ?? null })
          .returning();
        if (!wallet) throw new Error('Wallet insert returned no row');

        await tx.insert(balances).values(
          CURRENCIES.map((currency) => ({
            walletId: wallet.id,
            currency,
            kind: 'USER' as const,
          })),
        );

        return { wallet, balances: CURRENCIES.map((currency) => ({ currency, amount: 0n })) };
      });
    } catch (error) {
      // The unique constraints are the source of truth, which also makes concurrent creates safe.
      const constraint = uniqueViolation(error);
      if (constraint === 'wallets_email_key') throw new WalletExistsError('email');
      if (constraint === 'wallets_phone_key') throw new WalletExistsError('phone');
      throw error;
    }
  }

  async findById(walletId: string): Promise<WalletWithBalances> {
    const [wallet] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.id, walletId), eq(wallets.kind, 'USER')));
    if (!wallet) throw new WalletNotFoundError(walletId);

    const rows = await this.db
      .select({ currency: balances.currency, amount: balances.amount })
      .from(balances)
      .where(eq(balances.walletId, walletId));
    const byCurrency = new Map(rows.map((r) => [r.currency, r.amount]));

    return {
      wallet,
      balances: CURRENCIES.map((currency) => ({
        currency,
        amount: byCurrency.get(currency) ?? 0n,
      })),
    };
  }
}
