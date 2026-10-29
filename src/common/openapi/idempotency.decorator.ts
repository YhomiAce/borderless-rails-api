import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

/** Documents the Idempotency-Key header required on money-moving endpoints. */
export function ApiIdempotencyKey() {
  return applyDecorators(
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        'Unique per logical request (e.g. a UUID), 1-255 printable characters, scoped to the wallet. ' +
        'Retrying with the same key and body returns the original response with ' +
        '`Idempotent-Replayed: true` instead of moving money again. The same key with a different ' +
        'body is rejected with 422 IDEMPOTENCY_KEY_REUSED.',
      schema: { type: 'string', example: '3f2b6c1e-7d4a-4b8e-9a0f-1c2d3e4f5a6b' },
    }),
  );
}

export const REPLAY_HEADER = {
  'Idempotent-Replayed': {
    description: 'Present (value "true") when this response replays an earlier request',
    schema: { type: 'string' },
  },
};
