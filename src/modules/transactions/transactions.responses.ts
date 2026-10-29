import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CURRENCIES } from '../../domain/currency';

const side = z.object({
  currency: z.enum(CURRENCIES),
  amount: z.string().meta({ example: '10.000000' }),
});

export const transactionResponseSchema = z.object({
  id: z.uuid(),
  type: z.enum(['DEPOSIT', 'SWAP', 'TRANSFER']),
  status: z.enum(['COMPLETED']),
  fromWalletId: z
    .uuid()
    .nullable()
    .describe('Deposit: null. Swap: the wallet. Transfer: the sender.'),
  toWalletId: z.uuid().nullable().describe('Deposit and swap: the wallet. Transfer: the receiver.'),
  source: side,
  destination: side,
  rate: z
    .string()
    .meta({ example: '1500.000000000000000000' })
    .describe('Rate applied, source → destination, to 18 decimals'),
  rateSource: z
    .string()
    .meta({ example: 'live' })
    .describe('live, fallback (fixed table) or identity (same currency)'),
  rateTimestamp: z.iso.datetime().nullable().describe('When the rate was last refreshed'),
  reference: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export class TransactionResponseDto extends createZodDto(transactionResponseSchema) {}

export const historyPageSchema = z.object({
  data: z.array(
    transactionResponseSchema.extend({
      direction: z
        .enum(['IN', 'INTERNAL', 'SENT', 'RECEIVED'])
        .describe('Relative to the wallet whose history is listed'),
    }),
  ),
  pagination: z.object({
    limit: z.number().int(),
    nextCursor: z.string().nullable().describe('Pass as `cursor` to fetch the next page'),
    hasMore: z.boolean(),
  }),
});
export class HistoryPageDto extends createZodDto(historyPageSchema) {}
