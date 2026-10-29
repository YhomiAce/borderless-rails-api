import { z } from 'zod';

const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
    RUN_MIGRATIONS: flag('true'),

    FX_PROVIDER_URL: z.url().default('https://open.er-api.com/v6/latest/USD'),
    FX_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
    /** 0 disables background refreshes (and the refresh on boot). */
    FX_REFRESH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(10 * 60_000),
    /** Rates older than this are flagged as stale. The free provider publishes daily. */
    FX_MAX_STALENESS_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(36 * 60 * 60_000),

    RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }).optional(),
    RABBITMQ_EXCHANGE: z.string().min(1).default('borderless.events'),
    RABBITMQ_PUBLISH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    /** Publish committed outbox events to RabbitMQ from this process. */
    OUTBOX_RELAY_ENABLED: flag('true'),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
    /** Run the example subscriber that logs every event. */
    EVENTS_LOGGER_ENABLED: flag('true'),
    EVENTS_LOGGER_QUEUE: z.string().min(1).default('borderless.events-logger'),
    EVENTS_LOGGER_BINDING: z.string().min(1).default('#'),
  })
  .refine((env) => !(env.OUTBOX_RELAY_ENABLED || env.EVENTS_LOGGER_ENABLED) || env.RABBITMQ_URL, {
    message: 'Required when OUTBOX_RELAY_ENABLED or EVENTS_LOGGER_ENABLED is true',
    path: ['RABBITMQ_URL'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}

/** Same rule ConditionalModule uses before config is validated: on unless explicitly "false". */
export const isEnabled = (value: string | undefined): boolean => value !== 'false';
