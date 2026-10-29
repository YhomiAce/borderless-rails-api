import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../setup/app';
import { createTestDb, resetDatabase } from '../setup/db';

describe('Wallets API', () => {
  const { pool } = createTestDb();
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => resetDatabase(pool));
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /v1/wallets', () => {
    it('creates a wallet by email with a zero balance in every supported currency', async () => {
      const res = await http().post('/v1/wallets').send({ email: 'Ada@Example.com ' }).expect(201);

      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        email: 'ada@example.com',
        phone: null,
        createdAt: expect.any(String),
        balances: ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'].map((currency) => ({
          currency,
          amount: '0.000000',
        })),
      });
    });

    it('creates a wallet by phone, normalised to E.164', async () => {
      const res = await http().post('/v1/wallets').send({ phone: '0803 123 4567' }).expect(201);
      expect(res.body.phone).toBe('+2348031234567');
      expect(res.body.email).toBeNull();
    });

    it('accepts both email and phone', async () => {
      const res = await http()
        .post('/v1/wallets')
        .send({ email: 'both@example.com', phone: '+233241234567' })
        .expect(201);
      expect(res.body).toMatchObject({ email: 'both@example.com', phone: '+233241234567' });
    });

    it.each<[string, object]>([
      ['neither identifier', {}],
      ['an invalid email', { email: 'not-an-email' }],
      ['an invalid phone', { phone: '12' }],
      ['unknown fields', { email: 'a@b.com', extra: true }],
    ])('rejects %s', async (_case, body) => {
      const res = await http().post('/v1/wallets').send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a duplicate email regardless of case', async () => {
      await http().post('/v1/wallets').send({ email: 'dup@example.com' }).expect(201);
      const res = await http().post('/v1/wallets').send({ email: 'DUP@example.com' }).expect(409);
      expect(res.body.error).toMatchObject({ code: 'WALLET_EXISTS', details: { field: 'email' } });
    });

    it('rejects the same phone written in a different format', async () => {
      await http().post('/v1/wallets').send({ phone: '08031234567' }).expect(201);
      const res = await http().post('/v1/wallets').send({ phone: '+234 803 123 4567' }).expect(409);
      expect(res.body.error).toMatchObject({ code: 'WALLET_EXISTS', details: { field: 'phone' } });
    });

    it('lets exactly one of several concurrent creates for the same email succeed', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          http().post('/v1/wallets').send({ email: 'race@example.com' }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
    });
  });

  describe('GET /v1/wallets/:walletId', () => {
    it('returns the wallet with its balances', async () => {
      const created = await http().post('/v1/wallets').send({ email: 'get@example.com' });
      const res = await http().get(`/v1/wallets/${created.body.id}`).expect(200);
      expect(res.body).toEqual(created.body);
    });

    it('returns 404 for an unknown wallet', async () => {
      const res = await http().get('/v1/wallets/7c9e6679-7425-40de-944b-e07fc1f90ae7').expect(404);
      expect(res.body.error.code).toBe('WALLET_NOT_FOUND');
    });

    it('returns 400 for a malformed id', async () => {
      const res = await http().get('/v1/wallets/not-a-uuid').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
