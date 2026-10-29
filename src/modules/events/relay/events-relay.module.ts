import { Module } from '@nestjs/common';
import { EVENT_PUBLISHER } from './event-publisher';
import { OutboxRelay } from './outbox.relay';
import { RabbitMqPublisher } from './rabbitmq.publisher';

@Module({
  providers: [{ provide: EVENT_PUBLISHER, useClass: RabbitMqPublisher }, OutboxRelay],
  exports: [OutboxRelay],
})
export class EventsRelayModule {}
