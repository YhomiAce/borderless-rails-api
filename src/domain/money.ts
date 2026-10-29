import { CURRENCY_INFO, Currency } from './currency';

/**
 * Money is always an integer number of base units (bigint). With 6 decimals,
 * 1 cNGN = 1_000_000n. JavaScript numbers never hold amounts.
 */
export type Units = bigint;

const MAX_INTEGER_DIGITS = 24;

export class InvalidAmountError extends Error {}

function pow10(exp: number): bigint {
  return 10n ** BigInt(exp);
}

/**
 * Parses a decimal string ("1500", "1500.25") into base units.
 * Rejects (never rounds) anything with more decimals than the currency supports.
 */
export function parseAmount(value: string, currency: Currency): Units {
  const { decimals } = CURRENCY_INFO[currency];
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new InvalidAmountError(`"${value}" is not a valid decimal amount`);
  }
  const [, whole = '', fraction = ''] = match;
  if (whole.length > MAX_INTEGER_DIGITS) {
    throw new InvalidAmountError(`"${value}" is too large`);
  }
  if (fraction.length > decimals) {
    throw new InvalidAmountError(`${currency} supports at most ${decimals} decimal places`);
  }
  return BigInt(whole) * pow10(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** Formats base units as a fixed-precision decimal string, e.g. 1500250000n → "1500.250000". */
export function formatAmount(units: Units, currency: Currency): string {
  const { decimals } = CURRENCY_INFO[currency];
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const scale = pow10(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}${decimals > 0 ? `.${fraction}` : ''}`;
}
