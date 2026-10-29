import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Channel, ChannelModel, connect } from 'amqplib';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Env } from '../../src/config/env';
import { EventsLoggerConsumer } from '../../src/modules/events/consumer/events-logger.consumer';

describe('EventsLoggerConsumer', () => {
  const exchange = `test.events.${randomUUID()}`;
  const queue = `test.logger.${randomUUID()}`;
  const settings: Partial<Env> = {
    RABBITMQ_URL: inject('rabbitmqUrl'),
    RABBITMQ_EXCHANGE: exchange,
    EVENTS_LOGGER_QUEUE: queue,
    EVENTS_LOGGER_BINDING: 'wallet.*',
  };
  const consumer = new EventsLoggerConsumer({
    get: (key: keyof Env) => settings[key],
  } as unknown as ConfigService<Env, true>);
  let connection: ChannelModel;
  let channel: Channel;

  const publish = (routingKey: string, body: unknown) =>
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(body)));

  const event = (type: string) => ({
    eventId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateId: randomUUID(),
    data: { amount: '1.000000' },
  });

  async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Timed out waiting for condition');
  }

  beforeAll(async () => {
    await consumer.start();
    connection = await connect(settings.RABBITMQ_URL!);
    channel = await connection.createChannel();
  });
  afterAll(async () => {
    await consumer.onModuleDestroy();
    await channel.deleteQueue(queue);
    await channel.deleteQueue(`${queue}.dlq`);
    await channel.deleteExchange(exchange);
    await channel.deleteExchange(`${exchange}.dlx`);
    await connection.close();
  });

  it('consumes matching events once, ignores duplicates and dead-letters malformed ones', async () => {
    const credited = event('wallet.credited');
    publish('wallet.credited', credited);
    publish('wallet.credited', credited); // redelivery of the same event
    publish('wallet.debited', event('wallet.debited'));
    publish('transaction.completed', event('transaction.completed')); // not bound
    publish('wallet.credited', { not: 'an event' });

    await waitFor(
      () => consumer.stats.received + consumer.stats.duplicates + consumer.stats.deadLettered >= 4,
    );
    expect(consumer.stats).toEqual({ received: 2, duplicates: 1, deadLettered: 1 });
    await waitFor(async () => (await channel.checkQueue(`${queue}.dlq`)).messageCount === 1);
  });
});
