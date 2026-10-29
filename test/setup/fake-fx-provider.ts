import { Currency } from '../../src/domain/currency';
import { FxProvider, FxProviderError, UsdQuotes } from '../../src/modules/fx/providers/fx-provider';

/** Round numbers so expected conversions are easy to read in tests. */
export const TEST_USD_RATES: Record<Currency, string> = {
  USDx: '1',
  EURx: '0.8',
  cNGN: '1500',
  cGHS: '15',
  cXAF: '600',
};

export class FakeFxProvider implements FxProvider {
  readonly name = 'fake-provider';
  calls = 0;
  private next: () => Promise<UsdQuotes> = () =>
    Promise.resolve({ rates: { ...TEST_USD_RATES }, providerUpdatedAt: null });

  succeedWith(rates: Partial<Record<Currency, string>> = {}): this {
    this.next = () =>
      Promise.resolve({ rates: { ...TEST_USD_RATES, ...rates }, providerUpdatedAt: null });
    return this;
  }

  failWith(message = 'provider down'): this {
    this.next = () => Promise.reject(new FxProviderError(message));
    return this;
  }

  fetchUsdQuotes(): Promise<UsdQuotes> {
    this.calls += 1;
    return this.next();
  }
}
