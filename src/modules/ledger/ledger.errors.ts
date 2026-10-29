import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { Currency } from '../../domain/currency';
import { formatAmount, Units } from '../../domain/money';

export class InsufficientFundsError extends DomainError {
  constructor(currency: Currency, available: Units, required: Units) {
    super(
      'INSUFFICIENT_FUNDS',
      `Insufficient ${currency} balance`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      {
        currency,
        available: formatAmount(available, currency),
        required: formatAmount(required, currency),
      },
    );
  }
}
