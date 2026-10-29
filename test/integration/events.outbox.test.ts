import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RatesService } from '../../src/modules/fx/rates.service';
import { apiClient } from '../setup/api';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';

interface Row {
  type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
}

describe('Domain events recorded in the outbox', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  let rates: RatesService;
  let api: ReturnType<typeof apiClient>;

  const events = async () =>
    (
      await pool.query<Row>(
        `SELECT type, aggregate_id, payload FROM outbox_events ORDER BY occurred_at, id`,
      )
    ).rows;
  const clearOutbox = () => pool.query('DELETE FROM outbox_events');

  beforeAll(async () => {
    ({ app, rates } = await createTestApp());
    api = apiClient(app);
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    await rates.onModuleInit();
    await rates.refresh();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('emits wallet.created with masked contact details', async () => {
    const walletId = await api.createWallet('ada.lovelace@example.com');
    expect(await events()).toEqual([
      {
        type: 'wallet.created',
        aggregate_id: walletId,
        payload: {
          walletId,
          email: 'a***@example.com',
          phone: null,
          createdAt: expect.any(String),
        },
      },
    ]);
  });

  it('emits wallet.credited and transaction.completed for a deposit', async () => {
    const walletId = await api.createWallet();
    await clearOutbox();
    const deposit = await api.deposit(walletId, { currency: 'cNGN', amount: '500' }).expect(201);

    expect(await events()).toEqual([
      {
        type: 'wallet.credited',
        aggregate_id: walletId,
        payload: {
          walletId,
          currency: 'cNGN',
          amount: '500.000000',
          balanceAfter: '500.000000',
          transactionId: deposit.body.id,
          transactionType: 'DEPOSIT',
        },
      },
      { type: 'transaction.completed', aggregate_id: walletId, payload: deposit.body },
    ]);
  });

  it('emits a debit and a credit for a swap, and none for the FX pool', async () => {
    const walletId = await api.createWallet();
    await api.deposit(walletId, { currency: 'USDx', amount: '10' }).expect(201);
    await clearOutbox();
    await api
      .swap(walletId, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '10' })
      .expect(201);

    const rows = await events();
    expect(rows.map((r) => [r.type, r.aggregate_id, r.payload.currency])).toEqual([
      ['wallet.debited', walletId, 'USDx'],
      ['wallet.credited', walletId, 'EURx'],
      ['transaction.completed', walletId, undefined],
    ]);
    expect(rows[0]!.payload).toMatchObject({ amount: '10.000000', balanceAfter: '0.000000' });
  });

  it('emits for both sides of a cross-currency transfer', async () => {
    const alice = await api.createWallet();
    const bob = await api.createWallet();
    await api.deposit(alice, { currency: 'USDx', amount: '10' }).expect(201);
    await clearOutbox();
    await api
      .transfer({
        fromWalletId: alice,
        toWalletId: bob,
        fromCurrency: 'USDx',
        toCurrency: 'cGHS',
        amount: '2',
      })
      .expect(201);

    expect((await events()).map((r) => [r.type, r.aggregate_id, r.payload.amount])).toEqual([
      ['wallet.debited', alice, '2.000000'],
      ['wallet.credited', bob, '30.000000'],
      ['transaction.completed', alice, undefined],
    ]);
  });

  it('records nothing when an operation is rejected', async () => {
    const walletId = await api.createWallet();
    await clearOutbox();
    await api.swap(walletId, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '1' }).expect(422);
    expect(await events()).toEqual([]);
  });

  it('records nothing extra when a request is replayed', async () => {
    const walletId = await api.createWallet();
    await clearOutbox();
    await api.deposit(walletId, { currency: 'USDx', amount: '1' }, 'same-key').expect(201);
    await api.deposit(walletId, { currency: 'USDx', amount: '1' }, 'same-key').expect(201);
    expect(await events()).toHaveLength(2);
  });
});
