import { describe, expect, it } from 'vitest';
import { formatAmount, InvalidAmountError, parseAmount } from '../../src/domain/money';

describe('parseAmount', () => {
  it.each([
    ['1', 1_000_000n],
    ['0.000001', 1n],
    ['1500.25', 1_500_250_000n],
    ['1500.250000', 1_500_250_000n],
    ['0', 0n],
  ])('parses %s', (input, expected) => {
    expect(parseAmount(input, 'cNGN')).toBe(expected);
  });

  it('handles values far beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(parseAmount('123456789012345678.123456', 'cNGN')).toBe(123456789012345678123456n);
  });

  it.each(['1.1234567', '-1', '1e3', '1,000', ' 1', '', '.5', '1.', 'abc', '0x10'])(
    'rejects %j',
    (input) => {
      expect(() => parseAmount(input, 'USDx')).toThrow(InvalidAmountError);
    },
  );

  it('rejects absurdly large values', () => {
    expect(() => parseAmount('1'.repeat(25), 'USDx')).toThrow(InvalidAmountError);
  });
});

describe('formatAmount', () => {
  it.each([
    [0n, '0.000000'],
    [1n, '0.000001'],
    [1_500_250_000n, '1500.250000'],
    [-2_500_000n, '-2.500000'],
  ])('formats %s', (units, expected) => {
    expect(formatAmount(units, 'cGHS')).toBe(expected);
  });

  it('round-trips with parseAmount', () => {
    for (const value of ['0.000001', '42.5', '999999999999.999999']) {
      expect(parseAmount(formatAmount(parseAmount(value, 'EURx'), 'EURx'), 'EURx')).toBe(
        parseAmount(value, 'EURx'),
      );
    }
  });
});
