import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACCOUNTS } from '../../src/database/system-accounts';
import { RatesService } from '../../src/modules/fx/rates.service';
import { apiClient } from '../setup/api';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';
import { FakeFxProvider } from '../setup/fake-fx-provider';
import { expectLedgerInvariants } from '../setup/invariants';

describe('POST /v1/wallets/:walletId/swaps', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  let rates: RatesService;
  let fx: FakeFxProvider;
  let api: ReturnType<typeof apiClient>;
  let walletId: string;

  beforeAll(async () => {
    ({ app, rates, fx } = await createTestApp());
    api = apiClient(app);
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    await rates.onModuleInit();
    fx.succeedWith();
    await rates.refresh(); // USDx 1, EURx 0.8, cNGN 1500, cGHS 15, cXAF 600
    walletId = await api.createWallet();
    await api.deposit(walletId, { currency: 'USDx', amount: '100' }).expect(201);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('converts at the current rate and records the rate applied', async () => {
    const res = await api
      .swap(walletId, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '40' })
      .expect(201);

    expect(res.body).toMatchObject({
      type: 'SWAP',
      fromWalletId: walletId,
      toWalletId: walletId,
      source: { currency: 'USDx', amount: '40.000000' },
      destination: { currency: 'cNGN', amount: '60000.000000' },
      rate: '1500.000000000000000000',
      rateSource: 'live',
      rateTimestamp: expect.any(String),
    });
    expect(await api.balances(walletId)).toMatchObject({ USDx: '60.000000', cNGN: '60000.000000' });
    await expectLedgerInvariants(pool);
  });

  it('routes the conversion through the FX pool', async () => {
    await api
      .swap(walletId, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '10' })
      .expect(201);
    const { rows } = await pool.query<{ currency: string; amount: string }>(
      `SELECT currency, amount FROM balances WHERE wallet_id = $1 AND amount <> 0 ORDER BY currency`,
      [SYSTEM_ACCOUNTS.FX_POOL],
    );
    expect(rows).toEqual([
      { currency: 'USDx', amount: '10000000' },
      { currency: 'EURx', amount: '-8000000' },
    ]);
  });

  it('rejects a swap that would overdraw, changing nothing', async () => {
    const res = await api
      .swap(walletId, { fromCurrency: 'USDx', toCurrency: 'cGHS', amount: '100.000001' })
      .expect(422);

    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: { currency: 'USDx', available: '100.000000', required: '100.000001' },
    });
    expect(await api.balances(walletId)).toMatchObject({ USDx: '100.000000', cGHS: '0.000000' });
    const { rows } = await pool.query(`SELECT 1 FROM transactions WHERE type = 'SWAP'`);
    expect(rows).toHaveLength(0);
  });

  it('rejects swapping a currency for itself', async () => {
    const res = await api
      .swap(walletId, { fromCurrency: 'USDx', toCurrency: 'USDx', amount: '1' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects amounts that convert to less than one base unit', async () => {
    await api.deposit(walletId, { currency: 'cNGN', amount: '1' }).expect(201);
    const res = await api
      .swap(walletId, { fromCurrency: 'cNGN', toCurrency: 'USDx', amount: '0.000001' })
      .expect(422);
    expect(res.body.error.code).toBe('AMOUNT_TOO_SMALL');
  });

  it('reports a fallback rate when the provider has never succeeded', async () => {
    await pool.query(`DELETE FROM fx_rates`);
    await rates.onModuleInit(); // back to the fixed table only
    const res = await api
      .swap(walletId, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '1' })
      .expect(201);
    expect(res.body).toMatchObject({
      rateSource: 'fallback',
      destination: { currency: 'cNGN', amount: '1346.236888' },
    });
  });

  it('replays the original outcome even after rates move', async () => {
    const body = { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '10' };
    const first = await api.swap(walletId, body, 'swap-1').expect(201);

    fx.succeedWith({ cNGN: '2000' });
    await rates.refresh();
    const retry = await api.swap(walletId, body, 'swap-1').expect(201);

    expect(retry.body).toEqual(first.body);
    expect(retry.body.destination.amount).toBe('15000.000000');
    expect((await api.balances(walletId)).cNGN).toBe('15000.000000');
  });

  it('never overdraws under concurrent swaps', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        api.swap(walletId, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '10' }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(10);
    expect(await api.balances(walletId)).toMatchObject({ USDx: '0.000000', EURx: '80.000000' });
    await expectLedgerInvariants(pool);
  });
});
