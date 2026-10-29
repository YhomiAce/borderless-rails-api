import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RatesService } from '../../src/modules/fx/rates.service';
import { apiClient } from '../setup/api';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';
import { expectLedgerInvariants } from '../setup/invariants';

describe('POST /v1/wallets/:walletId/deposits', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  let rates: RatesService;
  let api: ReturnType<typeof apiClient>;
  let walletId: string;

  beforeAll(async () => {
    ({ app, rates } = await createTestApp());
    api = apiClient(app);
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    await rates.onModuleInit();
    walletId = await api.createWallet();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('credits the wallet immediately and records the transaction', async () => {
    const res = await api
      .deposit(walletId, { currency: 'cNGN', amount: '1500.25', reference: 'salary' })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      type: 'DEPOSIT',
      status: 'COMPLETED',
      fromWalletId: null,
      toWalletId: walletId,
      source: { currency: 'cNGN', amount: '1500.250000' },
      destination: { currency: 'cNGN', amount: '1500.250000' },
      rate: '1.000000000000000000',
      rateSource: 'identity',
      rateTimestamp: null,
      reference: 'salary',
      createdAt: expect.any(String),
    });
    expect((await api.balances(walletId)).cNGN).toBe('1500.250000');
    await expectLedgerInvariants(pool);
  });

  it.each<[string, object]>([
    ['a JSON number amount', { currency: 'USDx', amount: 10 }],
    ['a zero amount', { currency: 'USDx', amount: '0.000' }],
    ['a negative amount', { currency: 'USDx', amount: '-1' }],
    ['more than 6 decimals', { currency: 'USDx', amount: '1.1234567' }],
    ['an unsupported currency', { currency: 'BTC', amount: '1' }],
  ])('rejects %s', async (_case, body) => {
    const res = await api.deposit(walletId, body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires an Idempotency-Key header', async () => {
    const res = await api
      .http()
      .post(`/v1/wallets/${walletId}/deposits`)
      .send({ currency: 'USDx', amount: '1' })
      .expect(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await api
      .deposit('7c9e6679-7425-40de-944b-e07fc1f90ae7', { currency: 'USDx', amount: '1' })
      .expect(404);
    expect(res.body.error.code).toBe('WALLET_NOT_FOUND');
  });

  it('replays a retried request instead of crediting twice', async () => {
    const body = { currency: 'USDx', amount: '50' };
    const first = await api.deposit(walletId, body, 'retry-key').expect(201);
    const retry = await api.deposit(walletId, body, 'retry-key').expect(201);

    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect((await api.balances(walletId)).USDx).toBe('50.000000');
  });

  it('rejects reusing a key for a different request', async () => {
    await api.deposit(walletId, { currency: 'USDx', amount: '50' }, 'reused').expect(201);
    const res = await api
      .deposit(walletId, { currency: 'USDx', amount: '60' }, 'reused')
      .expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('credits once when the same request arrives concurrently', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.deposit(walletId, { currency: 'EURx', amount: '5' }, 'burst'),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect((await api.balances(walletId)).EURx).toBe('5.000000');
    await expectLedgerInvariants(pool);
  });
});
