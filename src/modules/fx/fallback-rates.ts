import { Currency } from '../../domain/currency';

/**
 * Fixed table used until the live provider has succeeded at least once.
 * Units per 1 USD, taken from open.er-api.com on 2026-10-29.
 */
export const FALLBACK_USD_RATES: Readonly<Record<Currency, string>> = {
  USDx: '1',
  EURx: '0.897215',
  cNGN: '1346.236888',
  cGHS: '11.639916',
  cXAF: '588.52908',
};

export const FALLBACK_SOURCE = 'fallback';
