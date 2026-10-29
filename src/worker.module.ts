import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateWorkerEnv, WorkerEnv } from './config/worker-env';
import { DatabaseModule } from './database/database.module';
import { EventsRelayModule } from './modules/events/relay/events-relay.module';

/** Background process: relays outbox events to RabbitMQ. Serves no HTTP. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateWorkerEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          ...(config.get('NODE_ENV', { infer: true }) === 'development' && {
            transport: { target: 'pino-pretty', options: { singleLine: true } },
          }),
        },
      }),
    }),
    DatabaseModule,
    EventsRelayModule,
  ],
})
export class WorkerModule {}
