import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  RUN_MIGRATIONS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
