import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CURRENCIES } from '../../domain/currency';

const money = (example: string) => z.string().meta({ example });

export const walletResponseSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable().meta({ example: 'ada@example.com' }),
  phone: z.string().nullable().meta({ example: '+2348031234567' }),
  createdAt: z.iso.datetime(),
  balances: z.array(
    z.object({
      currency: z.enum(CURRENCIES),
      amount: money('150000.000000'),
      usdValue: money('100.000000').describe('Value in USD at current rates, rounded down'),
    }),
  ),
  totalUsd: money('125.500000').describe('Sum of the USD values of all balances'),
  ratesAsOf: z.iso.datetime().describe('Refresh time of the oldest rate used for the valuation'),
});
export class WalletResponseDto extends createZodDto(walletResponseSchema) {}
