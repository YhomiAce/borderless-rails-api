import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RatesService } from '../../src/modules/fx/rates.service';
import { apiClient } from '../setup/api';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';

interface Item {
  id: string;
  type: string;
  direction: string;
  source: { currency: string };
  destination: { currency: string };
  createdAt: string;
}

describe('Transaction history', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  let rates: RatesService;
  let api: ReturnType<typeof apiClient>;
  let alice: string;
  let bob: string;
  const created: Record<string, string> = {};

  const list = async (walletId: string, query: Record<string, string | number> = {}) => {
    const res = await api
      .http()
      .get(`/v1/wallets/${walletId}/transactions`)
      .query(query)
      .expect(200);
    return res.body as {
      data: Item[];
      pagination: { limit: number; nextCursor: string | null; hasMore: boolean };
    };
  };

  beforeAll(async () => {
    ({ app, rates } = await createTestApp());
    api = apiClient(app);
    await resetDatabase(pool);
    await rates.onModuleInit();
    await rates.refresh();

    alice = await api.createWallet('alice@example.com');
    bob = await api.createWallet('bob@example.com');
    const ok = async (p: ReturnType<typeof api.deposit>) => (await p.expect(201)).body.id as string;
    created.aliceDeposit = await ok(api.deposit(alice, { currency: 'USDx', amount: '100' }));
    created.swap = await ok(
      api.swap(alice, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '10' }),
    );
    created.sent = await ok(
      api.transfer({ fromWalletId: alice, toWalletId: bob, fromCurrency: 'USDx', amount: '5' }),
    );
    created.bobDeposit = await ok(api.deposit(bob, { currency: 'cGHS', amount: '30' }));
    created.received = await ok(
      api.transfer({
        fromWalletId: bob,
        toWalletId: alice,
        fromCurrency: 'cGHS',
        toCurrency: 'cNGN',
        amount: '3',
      }),
    );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('lists deposits, swaps and transfers sent and received, newest first', async () => {
    const page = await list(alice);
    expect(page.data.map((t) => [t.id, t.direction])).toEqual([
      [created.received, 'RECEIVED'],
      [created.sent, 'SENT'],
      [created.swap, 'INTERNAL'],
      [created.aliceDeposit, 'IN'],
    ]);
    expect(page.pagination).toEqual({ limit: 20, nextCursor: null, hasMore: false });
  });

  it("shows the other side of a transfer in the receiver's history", async () => {
    const page = await list(bob);
    expect(page.data.map((t) => [t.id, t.direction])).toEqual([
      [created.received, 'SENT'],
      [created.bobDeposit, 'IN'],
      [created.sent, 'RECEIVED'],
    ]);
  });

  it('filters by type', async () => {
    const page = await list(alice, { type: 'TRANSFER' });
    expect(page.data.map((t) => t.id)).toEqual([created.received, created.sent]);
  });

  it('filters by currency on either side', async () => {
    const page = await list(alice, { currency: 'cNGN' });
    expect(page.data.map((t) => t.id)).toEqual([created.received, created.swap]);
  });

  it('combines filters', async () => {
    const page = await list(alice, { type: 'SWAP', currency: 'EURx' });
    expect(page.data).toEqual([]);
  });

  it.each<[string, Record<string, string | number>]>([
    ['an unknown type', { type: 'REFUND' }],
    ['an unsupported currency', { currency: 'BTC' }],
    ['a limit above 100', { limit: 101 }],
    ['a zero limit', { limit: 0 }],
  ])('rejects %s', async (_case, query) => {
    const res = await api.http().get(`/v1/wallets/${alice}/transactions`).query(query).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a tampered cursor', async () => {
    const res = await api
      .http()
      .get(`/v1/wallets/${alice}/transactions`)
      .query({ cursor: 'bm90LWEtY3Vyc29y' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await api
      .http()
      .get('/v1/wallets/7c9e6679-7425-40de-944b-e07fc1f90ae7/transactions')
      .expect(404);
    expect(res.body.error.code).toBe('WALLET_NOT_FOUND');
  });

  describe('pagination', () => {
    let carol: string;

    beforeAll(async () => {
      carol = await api.createWallet('carol@example.com');
      // Concurrent deposits make some rows share a millisecond, exercising the id tie-break.
      await Promise.all(
        Array.from({ length: 23 }, (_, i) =>
          api.deposit(carol, { currency: 'cXAF', amount: String(i + 1) }).expect(201),
        ),
      );
    });

    it('walks every page without gaps or duplicates, in order', async () => {
      const seen: Item[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await list(carol, { limit: 5, ...(cursor && { cursor }) });
        seen.push(...page.data);
        cursor = page.pagination.nextCursor;
        expect(page.pagination.hasMore).toBe(cursor !== null);
        pages += 1;
      } while (cursor);

      expect(pages).toBe(5);
      expect(seen).toHaveLength(23);
      expect(new Set(seen.map((t) => t.id)).size).toBe(23);

      const full = await list(carol, { limit: 100 });
      expect(seen.map((t) => t.id)).toEqual(full.data.map((t) => t.id));
    });

    it('keeps pages stable when new transactions arrive mid-walk', async () => {
      const first = await list(carol, { limit: 10 });
      await api.deposit(carol, { currency: 'cXAF', amount: '999' }).expect(201);
      const second = await list(carol, { limit: 10, cursor: first.pagination.nextCursor! });

      const firstIds = new Set(first.data.map((t) => t.id));
      expect(second.data.some((t) => firstIds.has(t.id))).toBe(false);
    });
  });

  describe('GET /v1/transactions/:transactionId', () => {
    it('returns a single transaction', async () => {
      const res = await api.http().get(`/v1/transactions/${created.received}`).expect(200);
      expect(res.body).toMatchObject({
        id: created.received,
        type: 'TRANSFER',
        fromWalletId: bob,
        toWalletId: alice,
        source: { currency: 'cGHS', amount: '3.000000' },
        destination: { currency: 'cNGN', amount: '300.000000' },
        rate: '100.000000000000000000',
      });
    });

    it('returns 404 for an unknown id', async () => {
      const res = await api
        .http()
        .get('/v1/transactions/7c9e6679-7425-40de-944b-e07fc1f90ae7')
        .expect(404);
      expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
    });
  });
});
