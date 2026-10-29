/**
 * Example subscriber for other teams. It binds its own durable queue to the
 * `borderless.events` topic exchange, logs every event and acks it.
 *
 * Patterns worth copying:
 * - Bind only the routing keys you need, e.g. "wallet.credited" or "transaction.*" ("#" = all).
 * - Delivery is at-least-once, so deduplicate on `eventId` (the AMQP messageId).
 * - Malformed messages are rejected without requeue and land in a dead-letter queue.
 */
import { ChannelModel, connect } from 'amqplib';
import pino from 'pino';
import { z } from 'zod';

const env = z
  .object({
    RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
    RABBITMQ_EXCHANGE: z.string().default('borderless.events'),
    CONSUMER_QUEUE: z.string().default('borderless.events-logger'),
    CONSUMER_BINDING: z.string().default('#'),
    LOG_LEVEL: z.string().default('info'),
  })
  .parse(process.env);

const envelopeSchema = z.object({
  eventId: z.uuid(),
  type: z.string(),
  version: z.number().int(),
  occurredAt: z.iso.datetime(),
  aggregateId: z.uuid(),
  data: z.record(z.string(), z.unknown()),
});

const logger = pino({ level: env.LOG_LEVEL, name: 'events-logger' });
const DEDUP_WINDOW = 10_000;

/** The broker can pass its health check slightly before it accepts connections. */
async function connectWithRetry(attempts = 10): Promise<ChannelModel> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect(env.RABBITMQ_URL);
    } catch (error) {
      if (attempt >= attempts) throw error;
      const delayMs = Math.min(500 * 2 ** (attempt - 1), 5_000);
      logger.warn({ attempt, delayMs }, 'RabbitMQ not reachable yet, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main(): Promise<void> {
  const connection = await connectWithRetry();
  const channel = await connection.createChannel();
  const deadLetterExchange = `${env.RABBITMQ_EXCHANGE}.dlx`;

  await channel.assertExchange(env.RABBITMQ_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(deadLetterExchange, 'fanout', { durable: true });
  await channel.assertQueue(`${env.CONSUMER_QUEUE}.dlq`, { durable: true });
  await channel.bindQueue(`${env.CONSUMER_QUEUE}.dlq`, deadLetterExchange, '');
  await channel.assertQueue(env.CONSUMER_QUEUE, { durable: true, deadLetterExchange });
  await channel.bindQueue(env.CONSUMER_QUEUE, env.RABBITMQ_EXCHANGE, env.CONSUMER_BINDING);
  await channel.prefetch(20);

  // Illustrative in-memory dedup; a real consumer would persist processed eventIds.
  const seen = new Set<string>();

  await channel.consume(env.CONSUMER_QUEUE, (msg) => {
    if (!msg) return;
    let parsed: z.infer<typeof envelopeSchema>;
    try {
      parsed = envelopeSchema.parse(JSON.parse(msg.content.toString('utf8')));
    } catch {
      logger.warn({ routingKey: msg.fields.routingKey }, 'malformed event, dead-lettering');
      channel.nack(msg, false, false);
      return;
    }

    if (seen.has(parsed.eventId)) {
      logger.info({ eventId: parsed.eventId }, 'duplicate event ignored');
    } else {
      seen.add(parsed.eventId);
      if (seen.size > DEDUP_WINDOW) seen.delete(seen.values().next().value!);
      logger.info({ routingKey: msg.fields.routingKey, event: parsed }, 'event received');
    }
    channel.ack(msg);
  });

  logger.info(
    { queue: env.CONSUMER_QUEUE, binding: env.CONSUMER_BINDING },
    `consuming from "${env.RABBITMQ_EXCHANGE}"`,
  );

  // Exit on connection loss; the container restart policy brings us back.
  connection.on('close', () => {
    logger.error('connection closed, exiting');
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void connection.close().finally(() => process.exit(0)));
  }
}

main().catch((error: unknown) => {
  logger.fatal(error, 'consumer failed to start');
  process.exit(1);
});
