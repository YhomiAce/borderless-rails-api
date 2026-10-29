import { CURRENCY_INFO, Currency } from './currency';
import { Units } from './money';

/** Rates are fixed-point bigints with 18 decimal places. */
export const RATE_DECIMALS = 18;
export const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

export type ScaledRate = bigint;

export class InvalidRateError extends Error {}

/** Parses a positive decimal string ("1346.236888") into a scaled rate. Extra precision is truncated. */
export function parseRate(value: string): ScaledRate {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new InvalidRateError(`"${value}" is not a valid rate`);
  }
  const [, whole = '', fraction = ''] = match;
  const scaled =
    BigInt(whole) * RATE_SCALE +
    BigInt(fraction.slice(0, RATE_DECIMALS).padEnd(RATE_DECIMALS, '0'));
  if (scaled <= 0n) {
    throw new InvalidRateError('Rate must be positive');
  }
  return scaled;
}

/** Converts a provider's JSON number (e.g. 1346.236888) into a scaled rate without float arithmetic. */
export function rateFromNumber(value: number): ScaledRate {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidRateError(`Rate must be a positive finite number, got ${value}`);
  }
  const text = value.toString();
  return parseRate(text.includes('e') ? value.toFixed(RATE_DECIMALS) : text);
}

export function formatRate(rate: ScaledRate): string {
  const whole = rate / RATE_SCALE;
  const fraction = (rate % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0');
  return `${whole}.${fraction}`;
}

/**
 * Cross rate from USD-pivoted quotes (units of currency per 1 USD):
 * rate(from → to) = usdRate[to] / usdRate[from], truncated to 18 decimals.
 */
export function crossRate(usdRateFrom: ScaledRate, usdRateTo: ScaledRate): ScaledRate {
  return (usdRateTo * RATE_SCALE) / usdRateFrom;
}

/**
 * Converts using the exact ratio of two USD-pivoted quotes, rounding down once at the end:
 * dest = amount × usdRateTo / usdRateFrom. Preferred over `convert` with a derived cross rate,
 * which would round twice (e.g. 15,000 cNGN at 1/1500 would give 9.999999 USDx instead of 10).
 */
export function convertViaUsd(
  amount: Units,
  from: Currency,
  to: Currency,
  usdRateFrom: ScaledRate,
  usdRateTo: ScaledRate,
): Units {
  const fromDecimals = BigInt(CURRENCY_INFO[from].decimals);
  const toDecimals = BigInt(CURRENCY_INFO[to].decimals);
  return (amount * usdRateTo * 10n ** toDecimals) / (usdRateFrom * 10n ** fromDecimals);
}

/**
 * Converts an amount with the given rate. Rounds down (truncates): the recipient never
 * receives more than the exact value; the dropped remainder is below one base unit.
 */
export function convert(amount: Units, from: Currency, to: Currency, rate: ScaledRate): Units {
  const fromDecimals = BigInt(CURRENCY_INFO[from].decimals);
  const toDecimals = BigInt(CURRENCY_INFO[to].decimals);
  return (amount * rate * 10n ** toDecimals) / (RATE_SCALE * 10n ** fromDecimals);
}
