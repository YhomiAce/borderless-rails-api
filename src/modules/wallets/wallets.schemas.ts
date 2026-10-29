import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Local numbers without a country code (e.g. 0803…) are read as Nigerian. */
export const DEFAULT_PHONE_REGION = 'NG';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = parsePhoneNumberFromString(value, DEFAULT_PHONE_REGION);
    if (!parsed?.isValid()) {
      ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
      return z.NEVER;
    }
    return parsed.number; // E.164, e.g. +2348031234567
  });

export const createWalletSchema = z
  .object({
    email: email.optional(),
    phone: phone.optional(),
  })
  .strict()
  .refine((v) => v.email !== undefined || v.phone !== undefined, {
    message: 'Provide an email or a phone number',
    path: ['email'],
  });

export class CreateWalletDto extends createZodDto(createWalletSchema) {}

export const walletIdParamSchema = z.object({ walletId: z.uuid() });
export class WalletIdParamDto extends createZodDto(walletIdParamSchema) {}
