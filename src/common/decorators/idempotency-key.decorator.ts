import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../modules/idempotency/idempotency.errors';

const VALID_KEY = /^[\x21-\x7E]{1,255}$/;

export function parseIdempotencyKey(header: string | string[] | undefined): string {
  if (header === undefined || header === '') throw new IdempotencyKeyRequiredError();
  if (Array.isArray(header) || !VALID_KEY.test(header)) throw new InvalidIdempotencyKeyError();
  return header;
}

/** Injects the validated `Idempotency-Key` header; rejects the request if it's missing. */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  parseIdempotencyKey(ctx.switchToHttp().getRequest<Request>().headers['idempotency-key']),
);
