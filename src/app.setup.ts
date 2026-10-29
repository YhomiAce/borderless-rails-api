import { INestApplication, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

/**
 * App-level configuration shared by main.ts and the test harness, so tests exercise
 * exactly the same HTTP surface as production.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.useLogger(app.get(Logger));
  express.use(helmet());
  express.useBodyParser('json', { limit: '100kb' });
  express.disable('x-powered-by');
  express.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  express.enableShutdownHooks();
}
