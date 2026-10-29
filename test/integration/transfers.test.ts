import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RatesService } from '../../src/modules/fx/rates.service';
import { apiClient } from '../setup/api';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';
import { expectLedgerInvariants } from '../setup/invariants';

describe('POST /v1/transfers', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  let rates: RatesService;
  let api: ReturnType<typeof apiClient>;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    ({ app, rates } = await createTestApp());
    api = apiClient(app);
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    await rates.onModuleInit();
    await rates.refresh(); // USDx 1, EURx 0.8, cNGN 1500, cGHS 15, cXAF 600
    alice = await api.createWallet('alice@example.com');
    bob = await api.createWallet('bob@example.com');
    await api.deposit(alice, { currency: 'USDx', amount: '100' }).expect(201);
    await api.deposit(alice, { currency: 'cGHS', amount: '50' }).expect(201);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('sends the same currency without conversion', async () => {
    const res = await api
      .transfer({ fromWalletId: alice, toWalletId: bob, fromCurrency: 'cGHS', amount: '20' })
      .expect(201);

    expect(res.body).toMatchObject({
      type: 'TRANSFER',
      fromWalletId: alice,
      toWalletId: bob,
      source: { currency: 'cGHS', amount: '20.000000' },
      destination: { currency: 'cGHS', amount: '20.000000' },
      rate: '1.000000000000000000',
      rateSource: 'identity',
    });
    expect((await api.balances(alice)).cGHS).toBe('30.000000');
    expect((await api.balances(bob)).cGHS).toBe('20.000000');
    await expectLedgerInvariants(pool);
  });

  it('converts automatically when the currencies differ, recording both sides and the rate', async () => {
    const res = await api
      .transfer({
        fromWalletId: alice,
        toWalletId: bob,
        fromCurrency: 'USDx',
        toCurrency: 'cNGN',
        amount: '10',
        reference: 'rent',
      })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      type: 'TRANSFER',
      status: 'COMPLETED',
      fromWalletId: alice,
      toWalletId: bob,
      source: { currency: 'USDx', amount: '10.000000' },
      destination: { currency: 'cNGN', amount: '15000.000000' },
      rate: '1500.000000000000000000',
      rateSource: 'live',
      rateTimestamp: expect.any(String),
      reference: 'rent',
      createdAt: expect.any(String),
    });
    expect((await api.balances(alice)).USDx).toBe('90.000000');
    expect((await api.balances(bob)).cNGN).toBe('15000.000000');
    await expectLedgerInvariants(pool);
  });

  it('returns 404 for an unknown receiver and leaves the sender untouched', async () => {
    const res = await api
      .transfer({
        fromWalletId: alice,
        toWalletId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        fromCurrency: 'USDx',
        amount: '1',
      })
      .expect(404);
    expect(res.body.error).toMatchObject({
      code: 'WALLET_NOT_FOUND',
      details: { walletId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
    });
    expect((await api.balances(alice)).USDx).toBe('100.000000');
  });

  it('rejects sending to the same wallet', async () => {
    const res = await api
      .transfer({ fromWalletId: alice, toWalletId: alice, fromCurrency: 'USDx', amount: '1' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects transfers beyond the balance', async () => {
    const res = await api
      .transfer({ fromWalletId: alice, toWalletId: bob, fromCurrency: 'cGHS', amount: '50.5' })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await api.balances(bob)).cGHS).toBe('0.000000');
  });

  it('cannot move money out of a system account', async () => {
    const res = await api
      .transfer({
        fromWalletId: '00000000-0000-0000-0000-000000000002',
        toWalletId: bob,
        fromCurrency: 'USDx',
        amount: '1',
      })
      .expect(400); // system account ids are not valid wallet UUIDs
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
