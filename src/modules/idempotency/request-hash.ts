import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively, so logically equal payloads hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return v;
  });
}

/** Fingerprint of a request: which operation, on what, with which (validated) payload. */
export function hashRequest(operation: string, payload: unknown): string {
  return createHash('sha256')
    .update(operation)
    .update('\n')
    .update(canonicalJson(payload))
    .digest('hex');
}
