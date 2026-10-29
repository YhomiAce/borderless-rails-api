import { Module } from '@nestjs/common';
import { EventsLoggerConsumer } from './events-logger.consumer';

@Module({
  providers: [EventsLoggerConsumer],
})
export class EventsLoggerModule {}
