import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, ChannelModel, connect, ConsumeMessage } from 'amqplib';
import { z } from 'zod';
import { Env } from '../../../config/env';

const envelopeSchema = z.object({
  eventId: z.uuid(),
  type: z.string(),
  version: z.number().int(),
  occurredAt: z.iso.datetime(),
  aggregateId: z.uuid(),
  data: z.record(z.string(), z.unknown()),
});

const DEDUP_WINDOW = 10_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Example subscriber, running in the API process. It is wired exactly as another team's
 * service would be: its own durable queue bound to the topic exchange, so publishing and
 * consuming stay decoupled even though they share a process here.
 *
 * - Binds only what it needs (EVENTS_LOGGER_BINDING; "#" = everything).
 * - Deduplicates on eventId, because delivery is at-least-once.
 * - Dead-letters malformed messages instead of retrying them forever.
 * - Never takes the API down: connection problems are retried in the background.
 */
@Injectable()
export class EventsLoggerConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('EventsLogger');
  private readonly url: string;
  private readonly exchange: string;
  private readonly queue: string;
  private readonly binding: string;
  private connection: ChannelModel | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  // Illustrative in-memory dedup; a real consumer would persist processed eventIds.
  private readonly seen = new Set<string>();

  readonly stats = { received: 0, duplicates: 0, deadLettered: 0 };

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('RABBITMQ_URL', { infer: true });
    if (!url) throw new Error('RABBITMQ_URL is required for the events logger');
    this.url = url;
    this.exchange = config.get('RABBITMQ_EXCHANGE', { infer: true });
    this.queue = config.get('EVENTS_LOGGER_QUEUE', { infer: true });
    this.binding = config.get('EVENTS_LOGGER_BINDING', { infer: true });
  }

  onApplicationBootstrap(): void {
    void this.start();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const connection = this.connection;
    this.connection = null;
    await connection?.close().catch(() => undefined);
  }

  /** Connects and starts consuming; on failure, schedules a retry with backoff. */
  async start(attempt = 1): Promise<void> {
    if (this.stopped) return;
    try {
      await this.connectAndConsume();
      this.logger.log(
        `Consuming "${this.queue}" bound to "${this.exchange}" with "${this.binding}"`,
      );
    } catch (error) {
      const delayMs = Math.min(500 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
      this.logger.warn(
        `RabbitMQ unavailable (${error instanceof Error ? error.message : String(error)}), retrying in ${delayMs}ms`,
      );
      this.scheduleReconnect(delayMs, attempt + 1);
    }
  }

  private async connectAndConsume(): Promise<void> {
    const connection = await connect(this.url);
    try {
      const channel = await connection.createChannel();
      const deadLetterExchange = `${this.exchange}.dlx`;
      await channel.assertExchange(this.exchange, 'topic', { durable: true });
      await channel.assertExchange(deadLetterExchange, 'fanout', { durable: true });
      await channel.assertQueue(`${this.queue}.dlq`, { durable: true });
      await channel.bindQueue(`${this.queue}.dlq`, deadLetterExchange, '');
      await channel.assertQueue(this.queue, { durable: true, deadLetterExchange });
      await channel.bindQueue(this.queue, this.exchange, this.binding);
      await channel.prefetch(20);
      await channel.consume(this.queue, (msg) => msg && this.handle(channel, msg));
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }

    this.connection = connection;
    connection.on('error', (err: Error) =>
      this.logger.warn(`RabbitMQ connection error: ${err.message}`),
    );
    connection.on('close', () => {
      this.connection = null;
      if (this.stopped) return;
      this.logger.warn('RabbitMQ connection lost, reconnecting');
      this.scheduleReconnect(1_000, 1);
    });
  }

  private handle(channel: Channel, msg: ConsumeMessage): void {
    let event: z.infer<typeof envelopeSchema>;
    try {
      event = envelopeSchema.parse(JSON.parse(msg.content.toString('utf8')));
    } catch {
      this.stats.deadLettered += 1;
      this.logger.warn(`Malformed event on "${msg.fields.routingKey}", dead-lettering`);
      channel.nack(msg, false, false);
      return;
    }

    if (this.seen.has(event.eventId)) {
      this.stats.duplicates += 1;
      this.logger.debug(`Duplicate event ${event.eventId} ignored`);
    } else {
      this.stats.received += 1;
      this.seen.add(event.eventId);
      if (this.seen.size > DEDUP_WINDOW) this.seen.delete(this.seen.values().next().value!);
      this.logger.log({ msg: `Event ${event.type}`, event });
    }
    channel.ack(msg);
  }

  private scheduleReconnect(delayMs: number, attempt: number): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => void this.start(attempt), delayMs);
  }
}
