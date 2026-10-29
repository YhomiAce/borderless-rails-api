export const CURRENCIES = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface CurrencyInfo {
  code: Currency;
  /** ISO 4217 fiat currency the stablecoin is pegged 1:1 to. */
  peg: string;
  /** Number of decimal places held in base units. */
  decimals: number;
  name: string;
}

export const CURRENCY_INFO: Readonly<Record<Currency, CurrencyInfo>> = {
  cNGN: { code: 'cNGN', peg: 'NGN', decimals: 6, name: 'Nigerian Naira stablecoin' },
  cGHS: { code: 'cGHS', peg: 'GHS', decimals: 6, name: 'Ghanaian Cedi stablecoin' },
  cXAF: { code: 'cXAF', peg: 'XAF', decimals: 6, name: 'Central African CFA franc stablecoin' },
  USDx: { code: 'USDx', peg: 'USD', decimals: 6, name: 'US Dollar stablecoin' },
  EURx: { code: 'EURx', peg: 'EUR', decimals: 6, name: 'Euro stablecoin' },
};

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}
