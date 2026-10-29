import { Currency } from '../../domain/currency';
import { formatAmount, Units } from '../../domain/money';
import { Wallet } from '../../database/schema';

export interface WalletBalance {
  currency: Currency;
  amount: Units;
}

export interface WalletWithBalances {
  wallet: Wallet;
  balances: WalletBalance[];
}

export function presentWallet({ wallet, balances }: WalletWithBalances) {
  return {
    id: wallet.id,
    email: wallet.email,
    phone: wallet.phone,
    createdAt: wallet.createdAt.toISOString(),
    balances: balances.map((b) => ({
      currency: b.currency,
      amount: formatAmount(b.amount, b.currency),
    })),
  };
}
