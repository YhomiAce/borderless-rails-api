import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import { uniqueViolation } from '../../database/pg-errors';
import { balances, wallets } from '../../database/schema';
import { Database } from '../../database/types';
import { CURRENCIES, Currency } from '../../domain/currency';
import { Units } from '../../domain/money';
import { RatesService } from '../fx/rates.service';
import { WalletView } from './wallets.presenter';
import { WalletExistsError, WalletNotFoundError } from './wallets.errors';

@Injectable()
export class WalletsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly rates: RatesService,
  ) {}

  async create(input: { email?: string; phone?: string }): Promise<WalletView> {
    try {
      const wallet = await this.db.transaction(async (tx) => {
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

        return wallet;
      });
      return this.withValuation(wallet, new Map());
    } catch (error) {
      // The unique constraints are the source of truth, which also makes concurrent creates safe.
      const constraint = uniqueViolation(error);
      if (constraint === 'wallets_email_key') throw new WalletExistsError('email');
      if (constraint === 'wallets_phone_key') throw new WalletExistsError('phone');
      throw error;
    }
  }

  async findById(walletId: string): Promise<WalletView> {
    const [wallet] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.id, walletId), eq(wallets.kind, 'USER')));
    if (!wallet) throw new WalletNotFoundError(walletId);

    const rows = await this.db
      .select({ currency: balances.currency, amount: balances.amount })
      .from(balances)
      .where(eq(balances.walletId, walletId));
    return this.withValuation(wallet, new Map(rows.map((r) => [r.currency, r.amount])));
  }

  /** Values each balance in USD at current rates (rounded down) and sums them. */
  private withValuation(wallet: WalletView['wallet'], amounts: Map<Currency, Units>): WalletView {
    let totalUsd = 0n;
    let ratesAsOf: Date | undefined;
    const balancesView = CURRENCIES.map((currency) => {
      const amount = amounts.get(currency) ?? 0n;
      const quote = this.rates.quote(currency, 'USDx');
      const usdValue = this.rates.convert(amount, quote);
      totalUsd += usdValue;
      if (!ratesAsOf || quote.refreshedAt < ratesAsOf) ratesAsOf = quote.refreshedAt;
      return { currency, amount, usdValue };
    });
    return { wallet, balances: balancesView, totalUsd, ratesAsOf: ratesAsOf ?? new Date() };
  }
}
