import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';

export class WalletNotFoundError extends DomainError {
  constructor(walletId: string) {
    super('WALLET_NOT_FOUND', `Wallet ${walletId} was not found`, HttpStatus.NOT_FOUND, {
      walletId,
    });
  }
}

export class WalletExistsError extends DomainError {
  constructor(field: 'email' | 'phone') {
    super('WALLET_EXISTS', `A wallet with this ${field} already exists`, HttpStatus.CONFLICT, {
      field,
    });
  }
}
