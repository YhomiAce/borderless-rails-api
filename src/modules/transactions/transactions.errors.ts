import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { Currency } from '../../domain/currency';

export class AmountTooSmallError extends DomainError {
  constructor(currency: Currency) {
    super(
      'AMOUNT_TOO_SMALL',
      `Amount converts to less than the smallest unit of ${currency}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { currency },
    );
  }
}

export class TransactionNotFoundError extends DomainError {
  constructor(transactionId: string) {
    super(
      'TRANSACTION_NOT_FOUND',
      `Transaction ${transactionId} was not found`,
      HttpStatus.NOT_FOUND,
      { transactionId },
    );
  }
}

export class InvalidCursorError extends DomainError {
  constructor() {
    super('INVALID_CURSOR', 'The pagination cursor is invalid', HttpStatus.BAD_REQUEST);
  }
}
