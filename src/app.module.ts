import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { Env, isEnabled, validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { EventsLoggerModule } from './modules/events/consumer/events-logger.module';
import { EventsModule } from './modules/events/events.module';
import { EventsRelayModule } from './modules/events/relay/events-relay.module';
import { FxModule } from './modules/fx/fx.module';
import { HealthModule } from './modules/health/health.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { WalletsModule } from './modules/wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (req, res) => {
            const header = req.headers['x-request-id'];
            const id = typeof header === 'string' && header.length <= 128 ? header : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: { ignore: (req) => req.url === '/health' },
          ...(config.get('NODE_ENV', { infer: true }) === 'development' && {
            transport: { target: 'pino-pretty', options: { singleLine: true } },
          }),
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    EventsModule,
    HealthModule,
    FxModule,
    WalletsModule,
    TransactionsModule,
    // Background event processing runs in the same process; each part can be switched off
    // (or moved to its own process) through configuration alone.
    ConditionalModule.registerWhen(EventsRelayModule, (env) => isEnabled(env.OUTBOX_RELAY_ENABLED)),
    ConditionalModule.registerWhen(EventsLoggerModule, (env) =>
      isEnabled(env.EVENTS_LOGGER_ENABLED),
    ),
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
