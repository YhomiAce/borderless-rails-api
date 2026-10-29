import { HttpStatus } from '@nestjs/common';

/**
 * Base class for expected, client-facing failures. The exception filter maps these
 * to the standard error envelope using `code` and `status`.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
