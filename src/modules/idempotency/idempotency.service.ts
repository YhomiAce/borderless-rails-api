import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { idempotencyKeys } from '../../database/schema';
import { DbTransaction } from '../../database/types';
import { IdempotencyKeyReusedError } from './idempotency.errors';

export interface IdempotencyContext {
  scope: string;
  key: string;
  requestHash: string;
}

export interface Outcome<T> {
  status: number;
  body: T;
  transactionId?: string;
}

export interface IdempotentResult<T> extends Outcome<T> {
  replayed: boolean;
}

/**
 * Runs `work` at most once per (scope, key), inside the caller's transaction.
 *
 * The key row is inserted in the same transaction as the money movement:
 * - a concurrent duplicate blocks on the primary key until the first transaction ends, then
 *   replays its stored response;
 * - if the first attempt fails and rolls back, the key disappears with it, so a retry runs fresh.
 */
@Injectable()
export class IdempotencyService {
  async execute<T>(
    tx: DbTransaction,
    ctx: IdempotencyContext,
    work: () => Promise<Outcome<T>>,
  ): Promise<IdempotentResult<T>> {
    const [claimed] = await tx
      .insert(idempotencyKeys)
      .values({ scope: ctx.scope, key: ctx.key, requestHash: ctx.requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (!claimed) {
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, ctx.scope), eq(idempotencyKeys.key, ctx.key)));
      if (!existing || existing.responseStatus === null) {
        throw new Error('Idempotency key exists without a stored response');
      }
      if (existing.requestHash !== ctx.requestHash) throw new IdempotencyKeyReusedError();
      return {
        status: existing.responseStatus,
        body: existing.responseBody as T,
        replayed: true,
        ...(existing.transactionId && { transactionId: existing.transactionId }),
      };
    }

    const outcome = await work();
    await tx
      .update(idempotencyKeys)
      .set({
        responseStatus: outcome.status,
        responseBody: outcome.body,
        transactionId: outcome.transactionId ?? null,
      })
      .where(and(eq(idempotencyKeys.scope, ctx.scope), eq(idempotencyKeys.key, ctx.key)));
    return { ...outcome, replayed: false };
  }
}
