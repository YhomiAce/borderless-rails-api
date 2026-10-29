import { describe, expect, it } from 'vitest';
import { parseIdempotencyKey } from '../../src/common/decorators/idempotency-key.decorator';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../src/modules/idempotency/idempotency.errors';
import { canonicalJson, hashRequest } from '../../src/modules/idempotency/request-hash';

describe('request hashing', () => {
  it('ignores object key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(hashRequest('swap', { from: 'USDx', to: 'cNGN' })).toBe(
      hashRequest('swap', { to: 'cNGN', from: 'USDx' }),
    );
  });

  it('distinguishes payloads and operations', () => {
    expect(hashRequest('swap', { amount: '1' })).not.toBe(hashRequest('swap', { amount: '2' }));
    expect(hashRequest('swap', { amount: '1' })).not.toBe(hashRequest('deposit', { amount: '1' }));
  });

  it('serialises bigints', () => {
    expect(canonicalJson({ amount: 10n })).toBe('{"amount":"10"}');
  });
});

describe('parseIdempotencyKey', () => {
  it('accepts printable keys up to 255 characters', () => {
    expect(parseIdempotencyKey('3f2b6c1e-7d4a-4b8e-9a0f-1c2d3e4f5a6b')).toBe(
      '3f2b6c1e-7d4a-4b8e-9a0f-1c2d3e4f5a6b',
    );
    expect(parseIdempotencyKey('k'.repeat(255))).toHaveLength(255);
  });

  it('requires the header', () => {
    expect(() => parseIdempotencyKey(undefined)).toThrow(IdempotencyKeyRequiredError);
    expect(() => parseIdempotencyKey('')).toThrow(IdempotencyKeyRequiredError);
  });

  it.each([['k'.repeat(256)], ['has space'], [['a', 'b']]])('rejects %j', (value) => {
    expect(() => parseIdempotencyKey(value)).toThrow(InvalidIdempotencyKeyError);
  });
});
