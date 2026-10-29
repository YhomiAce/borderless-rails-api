import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RatesService } from '../../src/modules/fx/rates.service';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';
import { FakeFxProvider } from '../setup/fake-fx-provider';

describe('FX rates', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  let fx: FakeFxProvider;
  let rates: RatesService;
  const getRates = () => request(app.getHttpServer()).get('/v1/rates').expect(200);

  beforeAll(async () => {
    ({ app, fx, rates } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    fx.succeedWith();
    fx.calls = 0;
    await rates.onModuleInit();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('serves the fixed fallback table before any live refresh', async () => {
    const res = await getRates();
    expect(res.body.status).toBe('pending');
    expect(res.body.currencies).toHaveLength(5);
    for (const c of res.body.currencies) expect(c.source).toBe('fallback');
    expect(res.body.pairs.every((p: { source: string }) => p.source === 'fallback')).toBe(true);
  });

  it('returns every pair between the five stablecoins with refresh times after a live refresh', async () => {
    await rates.refresh();
    const res = await getRates();

    expect(res.body).toMatchObject({ base: 'USDx', status: 'live', stale: false });
    expect(res.body.pairs).toHaveLength(20);
    expect(res.body.pairs).toContainEqual({
      from: 'USDx',
      to: 'cNGN',
      rate: '1500.000000000000000000',
      source: 'live',
      refreshedAt: expect.any(String),
    });
    expect(res.body.pairs).toContainEqual(
      expect.objectContaining({ from: 'EURx', to: 'cGHS', rate: '18.750000000000000000' }),
    );
    expect(res.body.currencies[0]).toMatchObject({ source: 'fake-provider' });
  });

  it('keeps serving the last good rates, with their original timestamps, when the provider fails', async () => {
    await rates.refresh();
    const before = (await getRates()).body;

    fx.failWith('timeout');
    await rates.refresh();
    const after = (await getRates()).body;

    expect(after.status).toBe('degraded');
    expect(after.pairs).toEqual(before.pairs);
    expect(after.currencies).toEqual(before.currencies);
    expect(after.lastAttemptAt).not.toBe(before.lastAttemptAt);
  });

  it('falls back to the fixed table when the provider has never succeeded', async () => {
    fx.failWith();
    await rates.refresh();
    const res = await getRates();
    expect(res.body.status).toBe('degraded');
    expect(
      res.body.currencies.find((c: { currency: string }) => c.currency === 'cNGN'),
    ).toMatchObject({ usdRate: '1346.236888000000000000', source: 'fallback' });
  });

  it('shares one provider call between concurrent refreshes', async () => {
    await Promise.all([rates.refresh(), rates.refresh(), rates.refresh()]);
    expect(fx.calls).toBe(1);
  });

  it('flags rates as stale once they are older than the staleness limit', async () => {
    await rates.refresh();
    await pool.query(`UPDATE fx_rates SET refreshed_at = now() - interval '3 days'`);
    fx.failWith();
    await rates.refresh();
    expect((await getRates()).body.stale).toBe(true);
  });
});
