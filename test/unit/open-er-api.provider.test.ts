import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Env } from '../../src/config/env';
import { FxProviderError } from '../../src/modules/fx/providers/fx-provider';
import { OpenErApiProvider } from '../../src/modules/fx/providers/open-er-api.provider';

const config = {
  get: (key: keyof Env) =>
    ({ FX_PROVIDER_URL: 'https://fx.test/latest/USD', FX_TIMEOUT_MS: 50 })[key as string],
} as unknown as ConfigService<Env, true>;

const okBody = {
  result: 'success',
  base_code: 'USD',
  time_last_update_unix: 1793232151,
  rates: { USD: 1, EUR: 0.897215, NGN: 1346.236888, GHS: 11.639916, XAF: 588.52908, GBP: 0.75 },
};

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('OpenErApiProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps pegged ISO codes to stablecoins as exact decimal strings', async () => {
    stubFetch(() => Promise.resolve(Response.json(okBody)));
    const quotes = await new OpenErApiProvider(config).fetchUsdQuotes();
    expect(quotes.rates).toEqual({
      cNGN: '1346.236888000000000000',
      cGHS: '11.639916000000000000',
      cXAF: '588.529080000000000000',
      USDx: '1.000000000000000000',
      EURx: '0.897215000000000000',
    });
    expect(quotes.providerUpdatedAt).toEqual(new Date(1793232151 * 1000));
  });

  it.each([
    ['a missing currency', { ...okBody, rates: { USD: 1, EUR: 0.9 } }],
    ['an error result', { ...okBody, result: 'error' }],
    ['a non-positive rate', { ...okBody, rates: { ...okBody.rates, NGN: 0 } }],
  ])('rejects %s', async (_case, body) => {
    stubFetch(() => Promise.resolve(Response.json(body)));
    await expect(new OpenErApiProvider(config).fetchUsdQuotes()).rejects.toThrow(FxProviderError);
  });

  it('rejects non-2xx responses', async () => {
    stubFetch(() => Promise.resolve(new Response('busy', { status: 503 })));
    await expect(new OpenErApiProvider(config).fetchUsdQuotes()).rejects.toThrow('HTTP 503');
  });

  it('rejects network failures and timeouts', async () => {
    stubFetch(() => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')));
    await expect(new OpenErApiProvider(config).fetchUsdQuotes()).rejects.toThrow(FxProviderError);
  });
});
