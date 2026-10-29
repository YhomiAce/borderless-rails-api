import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CURRENCIES } from '../domain/currency';
import { money, rate } from './columns';

// Tables are introduced feature by feature, each with its own migration (`yarn db:generate --name <feature>`).

export const currencyEnum = pgEnum('currency', CURRENCIES);
export const accountKindEnum = pgEnum('account_kind', ['USER', 'SYSTEM']);

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: accountKindEnum('kind').notNull().default('USER'),
    email: text('email'),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('wallets_email_key').on(t.email),
    unique('wallets_phone_key').on(t.phone),
    // Target for the composite FK from balances, so a balance's kind always matches its wallet.
    unique('wallets_id_kind_key').on(t.id, t.kind),
    check(
      'wallets_identifier_check',
      sql`${t.kind} = 'SYSTEM' OR ${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`,
    ),
  ],
);

export const balances = pgTable(
  'balances',
  {
    walletId: uuid('wallet_id').notNull(),
    currency: currencyEnum('currency').notNull(),
    kind: accountKindEnum('kind').notNull(),
    amount: money('amount')
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'balances_pkey', columns: [t.walletId, t.currency] }),
    foreignKey({
      name: 'balances_wallet_fk',
      columns: [t.walletId, t.kind],
      foreignColumns: [wallets.id, wallets.kind],
    }).onDelete('cascade'),
    // Last line of defence: user balances can never go negative, even if app logic is wrong.
    check('balances_non_negative_check', sql`${t.kind} = 'SYSTEM' OR ${t.amount} >= 0`),
  ],
);

/** Latest USD-pivoted quote per currency. Cross rates are derived from these. */
export const fxRates = pgTable('fx_rates', {
  currency: currencyEnum('currency').primaryKey(),
  /** Units of this currency per 1 USD. */
  usdRate: rate('usd_rate').notNull(),
  /** Where the quote came from, e.g. "open.er-api.com" or "fallback". */
  source: text('source').notNull(),
  /** When this service last stored the quote. */
  refreshedAt: timestamp('refreshed_at', { withTimezone: true, mode: 'date' }).notNull(),
  /** When the provider itself last updated the quote, if it says. */
  providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true, mode: 'date' }),
});

export type Wallet = typeof wallets.$inferSelect;
export type Balance = typeof balances.$inferSelect;
export type FxRateRow = typeof fxRates.$inferSelect;
