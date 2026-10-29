import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';

export class IdempotencyKeyRequiredError extends DomainError {
  constructor() {
    super(
      'IDEMPOTENCY_KEY_REQUIRED',
      'The Idempotency-Key header is required for this operation',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class InvalidIdempotencyKeyError extends DomainError {
  constructor() {
    super(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 1-255 printable ASCII characters',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with a different request',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
