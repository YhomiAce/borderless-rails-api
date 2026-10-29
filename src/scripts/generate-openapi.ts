/**
 * Writes openapi.json from the compiled app (decorator metadata is needed to discover DTOs).
 * Usage: yarn openapi:generate
 */
import './preview-env';
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { configureRouting } from '../app.setup';
import { buildOpenApiDocument } from '../openapi';

async function main(): Promise<void> {
  // Preview mode registers controllers without instantiating providers or connecting anywhere.
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  configureRouting(app);
  const target = path.resolve(process.cwd(), 'openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
  await app.close();
  console.log(`Wrote ${target}`);
}

void main();
