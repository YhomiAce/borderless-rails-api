import { Currency } from '../../../domain/currency';

export const FX_PROVIDER = Symbol('FX_PROVIDER');

export interface UsdQuotes {
  /** Units of each currency per 1 USD, as exact decimal strings. */
  rates: Record<Currency, string>;
  /** Provider's own last-update time, when it reports one. */
  providerUpdatedAt: Date | null;
}

export interface FxProvider {
  readonly name: string;
  /** Resolves with quotes for every supported currency, or rejects. Never returns partial data. */
  fetchUsdQuotes(): Promise<UsdQuotes>;
}

export class FxProviderError extends Error {}
