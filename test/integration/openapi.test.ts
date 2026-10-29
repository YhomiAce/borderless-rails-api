import { readFileSync } from 'node:fs';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../../src/common/openapi/error.schema';
import { ratesResponseSchema } from '../../src/modules/fx/rates.responses';
import { RatesService } from '../../src/modules/fx/rates.service';
import {
  historyPageSchema,
  transactionResponseSchema,
} from '../../src/modules/transactions/transactions.responses';
import { walletResponseSchema } from '../../src/modules/wallets/wallets.responses';
import { buildOpenApiDocument } from '../../src/openapi';
import { apiClient } from '../setup/api';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';

/** Fails on undocumented fields too, so the spec can't silently lag behind the code. */
const strictly = <T extends z.ZodObject>(schema: T) => schema.strict();

describe('OpenAPI', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  let rates: RatesService;
  let api: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    ({ app, rates } = await createTestApp());
    api = apiClient(app);
    await resetDatabase(pool);
    await rates.onModuleInit();
    await rates.refresh();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('matches the committed openapi.json (run `yarn openapi:generate` after API changes)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'openapi.json'), 'utf8'),
    );
    expect(buildOpenApiDocument(app)).toEqual(committed);
  });

  it('documents the responses the API actually returns', async () => {
    const alice = await api.createWallet();
    const bob = await api.createWallet();

    const wallet = await api.http().get(`/v1/wallets/${alice}`).expect(200);
    strictly(walletResponseSchema).parse(wallet.body);

    const deposit = await api.deposit(alice, { currency: 'USDx', amount: '20' }).expect(201);
    const swap = await api
      .swap(alice, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '5' })
      .expect(201);
    const transfer = await api
      .transfer({ fromWalletId: alice, toWalletId: bob, fromCurrency: 'USDx', amount: '1' })
      .expect(201);
    for (const res of [deposit, swap, transfer])
      strictly(transactionResponseSchema).parse(res.body);

    const single = await api.http().get(`/v1/transactions/${swap.body.id}`).expect(200);
    strictly(transactionResponseSchema).parse(single.body);

    const history = await api.http().get(`/v1/wallets/${alice}/transactions`).expect(200);
    strictly(historyPageSchema).parse(history.body);

    const ratesRes = await api.http().get('/v1/rates').expect(200);
    strictly(ratesResponseSchema).parse(ratesRes.body);

    const error = await api.http().get(`/v1/wallets/${alice}/transactions?limit=0`).expect(400);
    strictly(errorResponseSchema).parse(error.body);
  });
});
