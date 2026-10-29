import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Channel, ChannelModel, connect, GetMessage } from 'amqplib';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { Env } from '../../src/config/env';
import { EventEnvelope } from '../../src/modules/events/domain-events';
import { OutboxService } from '../../src/modules/events/outbox.service';
import { EventPublisher } from '../../src/modules/events/relay/event-publisher';
import { OutboxRelay } from '../../src/modules/events/relay/outbox.relay';
import { RabbitMqPublisher } from '../../src/modules/events/relay/rabbitmq.publisher';
import { createTestDb, resetDatabase } from '../setup/db';

describe('Outbox relay → RabbitMQ', () => {
  const { pool, db } = createTestDb();
  const exchange = `test.events.${randomUUID()}`;
  const settings: Partial<Env> = {
    RABBITMQ_URL: inject('rabbitmqUrl'),
    RABBITMQ_EXCHANGE: exchange,
    RABBITMQ_PUBLISH_TIMEOUT_MS: 5_000,
    OUTBOX_POLL_INTERVAL_MS: 500,
    OUTBOX_BATCH_SIZE: 100,
  };
  const config = {
    get: (key: keyof Env) => settings[key],
  } as unknown as ConfigService<Env, true>;

  const publisher = new RabbitMqPublisher(config);
  const relay = new OutboxRelay(db, publisher, config);
  const outbox = new OutboxService();
  let connection: ChannelModel;
  let channel: Channel;
  let queue: string;

  const record = (count: number) =>
    db.transaction((tx) =>
      outbox.record(
        tx,
        Array.from({ length: count }, (_, i) => ({
          type: i % 2 === 0 ? ('wallet.credited' as const) : ('transaction.completed' as const),
          aggregateId: randomUUID(),
          data: { n: i },
        })),
      ),
    );

  async function drain(expected: number): Promise<GetMessage[]> {
    const messages: GetMessage[] = [];
    for (let attempt = 0; attempt < 50 && messages.length < expected; attempt++) {
      const msg = await channel.get(queue, { noAck: true });
      if (msg) messages.push(msg);
      else await new Promise((r) => setTimeout(r, 50));
    }
    return messages;
  }

  beforeAll(async () => {
    connection = await connect(settings.RABBITMQ_URL!);
    channel = await connection.createChannel();
    await channel.assertExchange(exchange, 'topic', { durable: true });
    ({ queue } = await channel.assertQueue('', { exclusive: true }));
    await channel.bindQueue(queue, exchange, '#');
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    await channel.purgeQueue(queue);
  });
  afterAll(async () => {
    await publisher.onModuleDestroy();
    await channel.deleteExchange(exchange);
    await connection.close();
    await pool.end();
  });

  it('publishes committed events in order with routing key, messageId and headers', async () => {
    await record(3);
    expect(await relay.relayOnce()).toBe(3);

    const messages = await drain(3);
    const { rows } = await pool.query<{ id: string; published_at: Date | null }>(
      `SELECT id, published_at FROM outbox_events ORDER BY occurred_at, id`,
    );
    expect(messages.map((m) => m.properties.messageId)).toEqual(rows.map((r) => r.id));
    expect(messages.map((m) => m.fields.routingKey)).toEqual([
      'wallet.credited',
      'transaction.completed',
      'wallet.credited',
    ]);
    expect(rows.every((r) => r.published_at !== null)).toBe(true);

    const first = messages[0]!;
    expect(first.properties).toMatchObject({
      contentType: 'application/json',
      deliveryMode: 2,
      type: 'wallet.credited',
      headers: { 'x-event-version': 1 },
    });
    const body = JSON.parse(first.content.toString()) as EventEnvelope;
    expect(body).toEqual({
      eventId: rows[0]!.id,
      type: 'wallet.credited',
      version: 1,
      occurredAt: expect.any(String),
      aggregateId: expect.any(String),
      data: { n: 0 },
    });
  });

  it('does not republish events that were already sent', async () => {
    await record(2);
    await relay.relayOnce();
    expect(await relay.relayOnce()).toBe(0);
    expect(await drain(3)).toHaveLength(2);
  });

  it('keeps events unpublished when the broker is unavailable, then delivers them', async () => {
    await record(2);
    const failing: EventPublisher = { publish: () => Promise.reject(new Error('broker down')) };
    const brokenRelay = new OutboxRelay(db, failing, config);

    expect(await brokenRelay.relayOnce()).toBe(0);
    const { rows } = await pool.query<{ attempts: number; last_error: string | null }>(
      `SELECT attempts, last_error FROM outbox_events WHERE published_at IS NULL ORDER BY occurred_at`,
    );
    expect(rows).toEqual([
      { attempts: 1, last_error: 'broker down' },
      { attempts: 0, last_error: null },
    ]);

    expect(await relay.relayOnce()).toBe(2);
    expect(await drain(2)).toHaveLength(2);
  });

  it('lets concurrent relays share the work without double-publishing', async () => {
    await record(40);
    const second = new OutboxRelay(db, publisher, {
      get: (key: keyof Env) => (key === 'OUTBOX_BATCH_SIZE' ? 10 : settings[key]),
    } as unknown as ConfigService<Env, true>);

    let total = 0;
    for (let round = 0; round < 10 && total < 40; round++) {
      const sent = await Promise.all([relay.relayOnce(), second.relayOnce()]);
      total += sent[0] + sent[1];
    }
    const messages = await drain(41);
    expect(total).toBe(40);
    expect(new Set(messages.map((m) => m.properties.messageId)).size).toBe(40);
    expect(messages).toHaveLength(40);
  });
});
