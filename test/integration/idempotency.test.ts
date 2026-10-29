import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyKeyReusedError } from '../../src/modules/idempotency/idempotency.errors';
import { IdempotencyService } from '../../src/modules/idempotency/idempotency.service';
import { createTestDb, resetDatabase } from '../setup/db';

describe('IdempotencyService', () => {
  const { pool, db } = createTestDb();
  const idempotency = new IdempotencyService();
  const ctx = { scope: 'wallet:w1', key: 'key-1', requestHash: 'hash-a' };
  let runs: number;

  const work =
    (body: object = { ok: true }) =>
    async () => {
      runs += 1;
      // Simulate work that takes long enough for concurrent duplicates to overlap.
      await new Promise((r) => setTimeout(r, 20));
      return { status: 201, body };
    };

  const execute = (overrides: Partial<typeof ctx> = {}, w = work()) =>
    db.transaction((tx) => idempotency.execute(tx, { ...ctx, ...overrides }, w));

  beforeEach(async () => {
    await resetDatabase(pool);
    runs = 0;
  });
  afterAll(() => pool.end());

  it('runs the work once and replays the stored response afterwards', async () => {
    const first = await execute({}, work({ id: 'tx-1' }));
    const second = await execute({}, work({ id: 'tx-2' }));

    expect(first).toEqual({ status: 201, body: { id: 'tx-1' }, replayed: false });
    expect(second).toEqual({ status: 201, body: { id: 'tx-1' }, replayed: true });
    expect(runs).toBe(1);
  });

  it('rejects the same key with a different payload', async () => {
    await execute();
    await expect(execute({ requestHash: 'hash-b' })).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
  });

  it('keeps keys independent across scopes', async () => {
    await execute();
    const other = await execute({ scope: 'wallet:w2' });
    expect(other.replayed).toBe(false);
    expect(runs).toBe(2);
  });

  it('forgets the key when the work fails, so a retry runs fresh', async () => {
    const failing = () => Promise.reject(new Error('insufficient funds'));
    await expect(execute({}, failing)).rejects.toThrow('insufficient funds');

    const retry = await execute();
    expect(retry.replayed).toBe(false);
    expect(runs).toBe(1);
  });

  it('processes concurrent duplicates exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => execute()));
    expect(runs).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });
});
