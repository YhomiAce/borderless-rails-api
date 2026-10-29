import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Env } from '../../../config/env';
import { DRIZZLE } from '../../../database/database.constants';
import { outboxEvents } from '../../../database/schema';
import { Database } from '../../../database/types';
import { toEnvelope } from '../domain-events';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';

/**
 * Moves committed outbox rows to the broker. Rows are claimed with FOR UPDATE SKIP LOCKED,
 * so several worker replicas can run without publishing the same row concurrently.
 * Delivery is at-least-once: a crash between publish and commit republishes the row.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
    this.batchSize = config.get('OUTBOX_BATCH_SIZE', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Publishes one batch in order, stopping at the first failure. Returns how many were sent. */
  relayOnce(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
        .limit(this.batchSize)
        .for('update', { skipLocked: true });

      const published: string[] = [];
      for (const row of rows) {
        try {
          await this.publisher.publish(toEnvelope(row));
          published.push(row.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Publishing event ${row.id} failed, will retry: ${message}`);
          await tx
            .update(outboxEvents)
            .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: message })
            .where(eq(outboxEvents.id, row.id));
          break; // keep the remaining events in order for the next attempt
        }
      }

      if (published.length > 0) {
        await tx
          .update(outboxEvents)
          .set({
            publishedAt: new Date(),
            attempts: sql`${outboxEvents.attempts} + 1`,
            lastError: null,
          })
          .where(inArray(outboxEvents.id, published));
      }
      return published.length;
    });
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    let sent = 0;
    try {
      sent = await this.relayOnce();
    } catch (error) {
      this.logger.error(
        `Outbox relay failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // A full batch means there is probably more waiting, so go again straight away.
    this.schedule(sent === this.batchSize ? 0 : this.intervalMs);
  }
}
