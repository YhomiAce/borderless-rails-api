import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Borderless Rails API')
    .setDescription(
      [
        'Stablecoin-powered cross-border payments sandbox: multi-currency wallets, simulated deposits, ',
        'FX swaps and transfers across cNGN, cGHS, cXAF, USDx and EURx.',
        '',
        '- Amounts are decimal **strings** with up to 6 decimal places, never JSON numbers.',
        '- Money-moving POSTs require an `Idempotency-Key` header.',
        '- Errors share one envelope: `{ "error": { "code", "message", "details", "requestId" } }`.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addTag('Wallets')
    .addTag('Transactions', 'Deposits, swaps, transfers and history')
    .addTag('Rates')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
