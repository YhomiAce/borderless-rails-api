import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CURRENCIES } from '../../domain/currency';

export const currencySchema = z.enum(CURRENCIES);

/** Amounts are decimal strings (never JSON numbers) with up to 6 decimal places, and > 0. */
export const amountSchema = z
  .string()
  .regex(/^\d{1,24}(\.\d{1,6})?$/, 'Must be a decimal string with at most 6 decimal places')
  .refine((v) => /[1-9]/.test(v), 'Must be greater than zero')
  .meta({ example: '100.50', description: 'Decimal string, > 0, at most 6 decimal places' });

const referenceSchema = z.string().trim().min(1).max(140).optional();

export const depositSchema = z
  .object({
    currency: currencySchema,
    amount: amountSchema,
    reference: referenceSchema,
  })
  .strict();
export class DepositDto extends createZodDto(depositSchema) {}

export const swapSchema = z
  .object({
    fromCurrency: currencySchema,
    toCurrency: currencySchema,
    /** In fromCurrency. */
    amount: amountSchema,
  })
  .strict()
  .refine((v) => v.fromCurrency !== v.toCurrency, {
    message: 'fromCurrency and toCurrency must differ',
    path: ['toCurrency'],
  });
export class SwapDto extends createZodDto(swapSchema) {}

export const transferSchema = z
  .object({
    fromWalletId: z.uuid(),
    toWalletId: z.uuid(),
    fromCurrency: currencySchema,
    /** Defaults to fromCurrency; when different the amount is converted at the current rate. */
    toCurrency: currencySchema.optional(),
    /** In fromCurrency. */
    amount: amountSchema,
    reference: referenceSchema,
  })
  .strict()
  .refine((v) => v.fromWalletId !== v.toWalletId, {
    message: 'Cannot transfer to the same wallet',
    path: ['toWalletId'],
  });
export class TransferDto extends createZodDto(transferSchema) {}
