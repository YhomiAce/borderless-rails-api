import { z } from 'zod';
import { envSchema } from './env';

/** The worker needs everything the API does, plus RabbitMQ and relay settings. */
export const workerEnvSchema = envSchema.extend({
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  RABBITMQ_EXCHANGE: z.string().min(1).default('borderless.events'),
  RABBITMQ_PUBLISH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /** 0 disables the polling loop (tests drive the relay directly). */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().nonnegative().default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateWorkerEnv(raw: Record<string, unknown>): WorkerEnv {
  const result = workerEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid worker configuration: ${issues}`);
  }
  return result.data;
}
