import { Transaction } from '../../database/schema';
import { formatAmount } from '../../domain/money';

export type TransactionResponse = ReturnType<typeof presentTransaction>;

/**
 * fromWalletId/toWalletId read the same way for every type:
 * deposit: null → wallet, swap: wallet → wallet, transfer: sender → receiver.
 */
export function presentTransaction(t: Transaction) {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    fromWalletId: t.type === 'DEPOSIT' ? null : t.walletId,
    toWalletId: t.type === 'TRANSFER' ? t.counterpartyWalletId : t.walletId,
    source: { currency: t.sourceCurrency, amount: formatAmount(t.sourceAmount, t.sourceCurrency) },
    destination: {
      currency: t.destinationCurrency,
      amount: formatAmount(t.destinationAmount, t.destinationCurrency),
    },
    rate: t.rate,
    rateSource: t.rateSource,
    rateTimestamp: t.rateTimestamp?.toISOString() ?? null,
    reference: t.reference,
    createdAt: t.createdAt.toISOString(),
  };
}
