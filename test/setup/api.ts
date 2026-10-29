import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/** Thin HTTP helpers so tests read as API calls. */
export function apiClient(app: INestApplication) {
  const http = () => request(app.getHttpServer());

  return {
    http,
    async createWallet(email = `${randomUUID()}@example.com`): Promise<string> {
      const res = await http().post('/v1/wallets').send({ email }).expect(201);
      return res.body.id as string;
    },
    deposit(walletId: string, body: object, key: string = randomUUID()) {
      return http().post(`/v1/wallets/${walletId}/deposits`).set('Idempotency-Key', key).send(body);
    },
    swap(walletId: string, body: object, key: string = randomUUID()) {
      return http().post(`/v1/wallets/${walletId}/swaps`).set('Idempotency-Key', key).send(body);
    },
    transfer(body: object, key: string = randomUUID()) {
      return http().post('/v1/transfers').set('Idempotency-Key', key).send(body);
    },
    async balances(walletId: string): Promise<Record<string, string>> {
      const res = await http().get(`/v1/wallets/${walletId}`).expect(200);
      return Object.fromEntries(
        res.body.balances.map((b: { currency: string; amount: string }) => [b.currency, b.amount]),
      );
    },
  };
}
