import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelModel, ConfirmChannel, connect } from 'amqplib';
import { WorkerEnv } from '../../../config/worker-env';
import { EventEnvelope } from '../domain-events';
import { EventPublisher } from './event-publisher';

/**
 * Publishes to a durable topic exchange on a confirm channel, with the event type as routing
 * key. Connects lazily and reconnects on the next publish after the connection drops; the
 * relay's retry loop does the rest.
 */
@Injectable()
export class RabbitMqPublisher implements EventPublisher, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqPublisher.name);
  private readonly url: string;
  private readonly exchange: string;
  private readonly timeoutMs: number;
  private connection: ChannelModel | null = null;
  private channel: Promise<ConfirmChannel> | null = null;

  constructor(config: ConfigService<WorkerEnv, true>) {
    this.url = config.get('RABBITMQ_URL', { infer: true });
    this.exchange = config.get('RABBITMQ_EXCHANGE', { infer: true });
    this.timeoutMs = config.get('RABBITMQ_PUBLISH_TIMEOUT_MS', { infer: true });
  }

  async publish(event: EventEnvelope): Promise<void> {
    const channel = await this.getChannel();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for broker confirm')),
        this.timeoutMs,
      );
      channel.publish(
        this.exchange,
        event.type,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: event.eventId,
          type: event.type,
          timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
          headers: { 'x-event-version': event.version },
        },
        (err: unknown) => {
          clearTimeout(timer);
          if (err) reject(err instanceof Error ? err : new Error('Broker rejected the message'));
          else resolve();
        },
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close().catch(() => undefined);
  }

  private getChannel(): Promise<ConfirmChannel> {
    this.channel ??= this.open().catch((error: unknown) => {
      this.reset();
      throw error;
    });
    return this.channel;
  }

  private async open(): Promise<ConfirmChannel> {
    const connection = await connect(this.url);
    this.connection = connection;
    connection.on('error', (err: Error) =>
      this.logger.warn(`RabbitMQ connection error: ${err.message}`),
    );
    connection.on('close', () => this.reset());

    const channel = await connection.createConfirmChannel();
    channel.on('error', (err: Error) => this.logger.warn(`RabbitMQ channel error: ${err.message}`));
    channel.on('close', () => this.reset());
    await channel.assertExchange(this.exchange, 'topic', { durable: true });
    this.logger.log(`Connected to RabbitMQ, publishing to exchange "${this.exchange}"`);
    return channel;
  }

  private reset(): void {
    this.channel = null;
    this.connection = null;
  }
}
