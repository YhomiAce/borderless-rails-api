import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

export const transactionTypeEnum = pgEnum('transaction_type', ['DEPOSIT', 'SWAP', 'TRANSFER']);
// Operations are synchronous: a transaction row only exists once it has completed.
export const transactionStatusEnum = pgEnum('transaction_status', ['COMPLETED']);

/** One business event (deposit, swap or transfer). Its money movements live in ledger_entries. */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: transactionTypeEnum('type').notNull(),
    status: transactionStatusEnum('status').notNull().default('COMPLETED'),
    /** Initiator: the depositor, the swapper or the sender. */
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    /** Transfer receiver. */
    counterpartyWalletId: uuid('counterparty_wallet_id').references(() => wallets.id),
    sourceCurrency: currencyEnum('source_currency').notNull(),
    sourceAmount: money('source_amount').notNull(),
    destinationCurrency: currencyEnum('destination_currency').notNull(),
    destinationAmount: money('destination_amount').notNull(),
    /** Rate applied, source → destination (1 when the currencies match). */
    rate: rate('rate').notNull(),
    rateSource: text('rate_source').notNull(),
    rateTimestamp: timestamp('rate_timestamp', { withTimezone: true, mode: 'date' }),
    idempotencyKey: text('idempotency_key').notNull(),
    reference: text('reference'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // Second guarantee (after idempotency_keys) that one request can't produce two transactions.
    uniqueIndex('transactions_wallet_idempotency_key').on(t.walletId, t.idempotencyKey),
    index('transactions_wallet_history_idx').on(t.walletId, t.createdAt.desc(), t.id.desc()),
    index('transactions_counterparty_history_idx').on(
      t.counterpartyWalletId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'transactions_amounts_positive_check',
      sql`${t.sourceAmount} > 0 AND ${t.destinationAmount} > 0`,
    ),
  ],
);

/** Append-only double-entry ledger. Entries of a transaction sum to zero per currency. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    currency: currencyEnum('currency').notNull(),
    /** Signed: debit < 0, credit > 0. */
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_entries_transaction_idx').on(t.transactionId),
    index('ledger_entries_wallet_currency_idx').on(t.walletId, t.currency),
    check('ledger_entries_non_zero_check', sql`${t.amount} <> 0`),
  ],
);

/** Stored outcome of a money-moving request, keyed by the client's Idempotency-Key. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    /** Keys are scoped (e.g. per wallet) so different clients can't collide. */
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    transactionId: uuid('transaction_id').references(() => transactions.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'idempotency_keys_pkey', columns: [t.scope, t.key] })],
);

/**
 * Transactional outbox: domain events written in the same DB transaction as the change they
 * describe, then published to RabbitMQ by the worker's relay.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    /** Also the public eventId (AMQP messageId) consumers deduplicate on. */
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    version: integer('version').notNull().default(1),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    // clock_timestamp(), unlike now(), advances within a transaction, so events written
    // together keep the order they were recorded in.
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`clock_timestamp()`),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    // Keeps the relay's "what's unpublished?" query cheap however large the table grows.
    index('outbox_events_unpublished_idx')
      .on(t.occurredAt, t.id)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
);

export type Wallet = typeof wallets.$inferSelect;
export type Balance = typeof balances.$inferSelect;
export type FxRateRow = typeof fxRates.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
