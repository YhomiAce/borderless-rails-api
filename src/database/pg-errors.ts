import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

/** Unwraps the underlying pg error (Drizzle wraps driver errors in DrizzleQueryError). */
export function asPgError(error: unknown): DatabaseError | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof DatabaseError ? cause : undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';

/** Returns the violated constraint name when the error is a unique violation. */
export function uniqueViolation(error: unknown): string | undefined {
  const pg = asPgError(error);
  return pg?.code === PG_UNIQUE_VIOLATION ? (pg.constraint ?? 'unknown') : undefined;
}
