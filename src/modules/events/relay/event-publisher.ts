import { EventEnvelope } from '../domain-events';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface EventPublisher {
  /** Resolves once the broker has confirmed the message; rejects otherwise. */
  publish(event: EventEnvelope): Promise<void>;
}
