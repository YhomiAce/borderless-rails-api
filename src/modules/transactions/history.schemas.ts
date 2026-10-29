import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { currencySchema } from './transactions.schemas';

export const historyQuerySchema = z
  .object({
    type: z.enum(['DEPOSIT', 'SWAP', 'TRANSFER']).optional(),
    /** Matches either side of the transaction. */
    currency: currencySchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** Opaque cursor from a previous page's `pagination.nextCursor`. */
    cursor: z.string().max(200).optional(),
  })
  .strict();
export class HistoryQueryDto extends createZodDto(historyQuerySchema) {}

export const transactionIdParamSchema = z.object({ transactionId: z.uuid() });
export class TransactionIdParamDto extends createZodDto(transactionIdParamSchema) {}
