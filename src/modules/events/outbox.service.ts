import { Injectable } from '@nestjs/common';
import { outboxEvents } from '../../database/schema';
import { DbTransaction } from '../../database/types';
import { NewDomainEvent } from './domain-events';

/**
 * Records events in the caller's transaction. They become visible to the relay only if that
 * transaction commits, so consumers never hear about changes that were rolled back.
 */
@Injectable()
export class OutboxService {
  async record(tx: DbTransaction, events: NewDomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await tx.insert(outboxEvents).values(
      events.map((e) => ({
        type: e.type,
        version: e.version ?? 1,
        aggregateId: e.aggregateId,
        payload: e.data,
      })),
    );
  }
}
