import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().meta({ example: 'INSUFFICIENT_FUNDS' }),
    message: z.string().meta({ example: 'Insufficient USDx balance' }),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export class ErrorResponseDto extends createZodDto(errorResponseSchema) {}

const DESCRIPTIONS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Validation failed (VALIDATION_ERROR) or a header is missing/invalid',
  [HttpStatus.NOT_FOUND]: 'Resource not found',
  [HttpStatus.CONFLICT]: 'Conflicts with an existing resource',
  [HttpStatus.UNPROCESSABLE_ENTITY]:
    'Business rule rejected the request (INSUFFICIENT_FUNDS, AMOUNT_TOO_SMALL, IDEMPOTENCY_KEY_REUSED)',
};

/** Documents error responses, all of which share the standard error envelope. */
export function ApiErrors(...statuses: HttpStatus[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: DESCRIPTIONS[status], type: ErrorResponseDto.Output }),
    ),
  );
}
