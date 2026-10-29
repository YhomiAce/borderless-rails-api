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
