import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CURRENCIES } from '../../domain/currency';

export const ratesResponseSchema = z.object({
  base: z.literal('USDx'),
  status: z
    .enum(['pending', 'live', 'degraded'])
    .describe(
      'live: last refresh succeeded. degraded: it failed and older rates are served. pending: no refresh attempted yet.',
    ),
  stale: z.boolean().describe('True when any rate is older than the staleness limit'),
  lastAttemptAt: z.iso.datetime().nullable(),
  currencies: z.array(
    z.object({
      currency: z.enum(CURRENCIES),
      usdRate: z.string().meta({ example: '1346.236888000000000000' }).describe('Units per 1 USD'),
      source: z.string().meta({ example: 'open.er-api.com' }),
      refreshedAt: z.iso.datetime(),
      providerUpdatedAt: z.iso.datetime().nullable(),
    }),
  ),
  pairs: z.array(
    z.object({
      from: z.enum(CURRENCIES),
      to: z.enum(CURRENCIES),
      rate: z.string().meta({ example: '0.000742813000000000' }),
      source: z.enum(['live', 'fallback', 'identity']),
      refreshedAt: z.iso.datetime().describe('The older of the two legs’ refresh times'),
    }),
  ),
});
export class RatesResponseDto extends createZodDto(ratesResponseSchema) {}
