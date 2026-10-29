import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import { NewTransaction, transactions, wallets } from '../../database/schema';
import { SYSTEM_ACCOUNTS } from '../../database/system-accounts';
import { Database, DbTransaction } from '../../database/types';
import { Currency } from '../../domain/currency';
import { formatRate } from '../../domain/fx';
import { parseAmount, Units } from '../../domain/money';
import { OutboxService } from '../events/outbox.service';
import { RatesService } from '../fx/rates.service';
import { IdempotencyService, IdempotentResult } from '../idempotency/idempotency.service';
import { hashRequest } from '../idempotency/request-hash';
import { LedgerLine, LedgerService } from '../ledger/ledger.service';
import { WalletNotFoundError } from '../wallets/wallets.errors';
import { presentTransaction, TransactionResponse } from './transaction.presenter';
import { AmountTooSmallError } from './transactions.errors';

export interface DepositCommand {
  walletId: string;
  currency: Currency;
  amount: string;
  reference?: string;
  idempotencyKey: string;
}

export interface SwapCommand {
  walletId: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  amount: string;
  idempotencyKey: string;
}

export interface TransferCommand {
  fromWalletId: string;
  toWalletId: string;
  fromCurrency: Currency;
  toCurrency?: Currency;
  amount: string;
  reference?: string;
  idempotencyKey: string;
}

type Result = IdempotentResult<TransactionResponse>;

/**
 * Deposits, swaps and transfers. Each runs in one database transaction that claims the
 * idempotency key, records the transaction and posts balanced ledger lines.
 */
@Injectable()
export class MoneyMovementService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly rates: RatesService,
    private readonly outbox: OutboxService,
  ) {}

  deposit(cmd: DepositCommand): Promise<Result> {
    const { idempotencyKey, ...request } = cmd;
    const amount = parseAmount(cmd.amount, cmd.currency);
    return this.run(cmd.walletId, idempotencyKey, 'deposit', request, async (tx) => {
      await this.assertUserWallets(tx, [cmd.walletId]);
      return this.record(
        tx,
        {
          type: 'DEPOSIT',
          walletId: cmd.walletId,
          idempotencyKey: cmd.idempotencyKey,
          sourceCurrency: cmd.currency,
          sourceAmount: amount,
          destinationCurrency: cmd.currency,
          destinationAmount: amount,
          rate: formatRate(10n ** 18n),
          rateSource: 'identity',
          reference: cmd.reference ?? null,
        },
        [
          { walletId: SYSTEM_ACCOUNTS.MINT, currency: cmd.currency, amount: -amount },
          { walletId: cmd.walletId, currency: cmd.currency, amount },
        ],
      );
    });
  }

  swap(cmd: SwapCommand): Promise<Result> {
    const amount = parseAmount(cmd.amount, cmd.fromCurrency);
    // Priced before the transaction starts, so no network or CPU work happens while rows are locked.
    const conversion = this.price(amount, cmd.fromCurrency, cmd.toCurrency);
    const { idempotencyKey, ...request } = cmd;
    return this.run(cmd.walletId, idempotencyKey, 'swap', request, async (tx) => {
      await this.assertUserWallets(tx, [cmd.walletId]);
      return this.record(
        tx,
        {
          type: 'SWAP',
          walletId: cmd.walletId,
          idempotencyKey: cmd.idempotencyKey,
          sourceCurrency: cmd.fromCurrency,
          sourceAmount: amount,
          destinationCurrency: cmd.toCurrency,
          destinationAmount: conversion.amount,
          ...conversion.rateFields,
        },
        convertingLines(
          cmd.walletId,
          cmd.walletId,
          cmd.fromCurrency,
          amount,
          cmd.toCurrency,
          conversion.amount,
        ),
      );
    });
  }

  transfer(cmd: TransferCommand): Promise<Result> {
    const toCurrency = cmd.toCurrency ?? cmd.fromCurrency;
    const amount = parseAmount(cmd.amount, cmd.fromCurrency);
    const conversion = this.price(amount, cmd.fromCurrency, toCurrency);
    const { idempotencyKey, ...rest } = cmd;
    const request = { ...rest, toCurrency };
    return this.run(cmd.fromWalletId, idempotencyKey, 'transfer', request, async (tx) => {
      await this.assertUserWallets(tx, [cmd.fromWalletId, cmd.toWalletId]);
      const lines: LedgerLine[] =
        cmd.fromCurrency === toCurrency
          ? [
              { walletId: cmd.fromWalletId, currency: cmd.fromCurrency, amount: -amount },
              { walletId: cmd.toWalletId, currency: toCurrency, amount },
            ]
          : convertingLines(
              cmd.fromWalletId,
              cmd.toWalletId,
              cmd.fromCurrency,
              amount,
              toCurrency,
              conversion.amount,
            );
      return this.record(
        tx,
        {
          type: 'TRANSFER',
          walletId: cmd.fromWalletId,
          idempotencyKey: cmd.idempotencyKey,
          counterpartyWalletId: cmd.toWalletId,
          sourceCurrency: cmd.fromCurrency,
          sourceAmount: amount,
          destinationCurrency: toCurrency,
          destinationAmount: conversion.amount,
          reference: cmd.reference ?? null,
          ...conversion.rateFields,
        },
        lines,
      );
    });
  }

  /** Wraps an operation in a DB transaction guarded by the wallet-scoped idempotency key. */
  private run(
    walletId: string,
    idempotencyKey: string,
    operation: string,
    request: object,
    work: (tx: DbTransaction) => Promise<Transaction>,
  ): Promise<Result> {
    return this.db.transaction((tx) =>
      this.idempotency.execute(
        tx,
        {
          scope: `wallet:${walletId}`,
          key: idempotencyKey,
          requestHash: hashRequest(operation, request),
        },
        async () => {
          const created = await work(tx);
          return {
            status: HttpStatus.CREATED,
            body: presentTransaction(created),
            transactionId: created.id,
          };
        },
      ),
    );
  }

  private async record(
    tx: DbTransaction,
    values: NewTransaction,
    lines: LedgerLine[],
  ): Promise<Transaction> {
    const [created] = await tx.insert(transactions).values(values).returning();
    if (!created) throw new Error('Transaction insert returned no row');
    await this.ledger.post(tx, created, lines);
    await this.outbox.record(tx, [
      {
        type: 'transaction.completed',
        aggregateId: created.walletId,
        data: presentTransaction(created),
      },
    ]);
    return created;
  }

  private price(amount: Units, from: Currency, to: Currency) {
    const quote = this.rates.quote(from, to);
    const converted = this.rates.convert(amount, quote);
    if (converted <= 0n) throw new AmountTooSmallError(to);
    return {
      amount: converted,
      rateFields: {
        rate: formatRate(quote.rate),
        rateSource: quote.source,
        rateTimestamp: quote.source === 'identity' ? null : quote.refreshedAt,
      },
    };
  }

  private async assertUserWallets(tx: DbTransaction, ids: string[]): Promise<void> {
    const found = await tx
      .select({ id: wallets.id })
      .from(wallets)
      .where(and(inArray(wallets.id, ids), eq(wallets.kind, 'USER')));
    const missing = ids.find((id) => !found.some((f) => f.id === id));
    if (missing) throw new WalletNotFoundError(missing);
  }
}

type Transaction = typeof transactions.$inferSelect;

/** Cross-currency movement through the FX pool: it takes the source and pays out the destination. */
function convertingLines(
  fromWalletId: string,
  toWalletId: string,
  fromCurrency: Currency,
  amount: Units,
  toCurrency: Currency,
  converted: Units,
): LedgerLine[] {
  return [
    { walletId: fromWalletId, currency: fromCurrency, amount: -amount },
    { walletId: SYSTEM_ACCOUNTS.FX_POOL, currency: fromCurrency, amount },
    { walletId: SYSTEM_ACCOUNTS.FX_POOL, currency: toCurrency, amount: -converted },
    { walletId: toWalletId, currency: toCurrency, amount: converted },
  ];
}
