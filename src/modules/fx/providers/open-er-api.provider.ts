import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { Env } from '../../../config/env';
import { CURRENCIES, CURRENCY_INFO, Currency } from '../../../domain/currency';
import { formatRate, rateFromNumber } from '../../../domain/fx';
import { FxProvider, FxProviderError, UsdQuotes } from './fx-provider';

const responseSchema = z.object({
  result: z.literal('success'),
  base_code: z.literal('USD'),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number().positive()),
});

/** ExchangeRate-API's free, keyless endpoint (https://www.exchangerate-api.com/docs/free). */
@Injectable()
export class OpenErApiProvider implements FxProvider {
  readonly name = 'open.er-api.com';
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('FX_PROVIDER_URL', { infer: true });
    this.timeoutMs = config.get('FX_TIMEOUT_MS', { infer: true });
  }

  async fetchUsdQuotes(): Promise<UsdQuotes> {
    let body: unknown;
    try {
      const res = await fetch(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new FxProviderError(`HTTP ${res.status}`);
      body = await res.json();
    } catch (error) {
      if (error instanceof FxProviderError) throw error;
      throw new FxProviderError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new FxProviderError('Unexpected response shape');

    const rates = {} as Record<Currency, string>;
    for (const currency of CURRENCIES) {
      const value = parsed.data.rates[CURRENCY_INFO[currency].peg];
      if (value === undefined) {
        throw new FxProviderError(`Missing rate for ${CURRENCY_INFO[currency].peg}`);
      }
      rates[currency] = formatRate(rateFromNumber(value));
    }

    return { rates, providerUpdatedAt: new Date(parsed.data.time_last_update_unix * 1000) };
  }
}
