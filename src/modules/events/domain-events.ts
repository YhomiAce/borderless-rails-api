import { OutboxEvent } from '../../database/schema';

export const EVENT_TYPES = [
  'wallet.created',
  'wallet.credited',
  'wallet.debited',
  'transaction.completed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** An event to be recorded in the outbox. */
export interface NewDomainEvent {
  type: EventType;
  aggregateId: string;
  data: Record<string, unknown>;
  version?: number;
}

/** The message body consumers receive. The AMQP routing key is `type`. */
export interface EventEnvelope {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  aggregateId: string;
  data: unknown;
}

export function toEnvelope(row: OutboxEvent): EventEnvelope {
  return {
    eventId: row.id,
    type: row.type,
    version: row.version,
    occurredAt: row.occurredAt.toISOString(),
    aggregateId: row.aggregateId,
    data: row.payload,
  };
}

/** Keeps contact details out of the event stream while still hinting at the identifier. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `${phone.slice(0, 4)}${'*'.repeat(Math.max(phone.length - 8, 0))}${phone.slice(-4)}`;
}
