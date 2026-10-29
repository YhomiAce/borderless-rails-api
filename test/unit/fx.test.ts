import { describe, expect, it } from 'vitest';
import {
  convert,
  crossRate,
  formatRate,
  InvalidRateError,
  parseRate,
  RATE_SCALE,
  rateFromNumber,
} from '../../src/domain/fx';
import { parseAmount } from '../../src/domain/money';

describe('rate parsing', () => {
  it('parses decimal strings to 18-decimal fixed point', () => {
    expect(parseRate('1')).toBe(RATE_SCALE);
    expect(formatRate(parseRate('1346.236888'))).toBe('1346.236888000000000000');
  });

  it('converts provider numbers without float error, including exponent notation', () => {
    expect(formatRate(rateFromNumber(0.897215))).toBe('0.897215000000000000');
    expect(rateFromNumber(1e-7)).toBe(100_000_000_000n);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (value) => {
    expect(() => rateFromNumber(value)).toThrow(InvalidRateError);
  });

  it('rejects a zero rate string', () => {
    expect(() => parseRate('0.000')).toThrow(InvalidRateError);
  });
});

describe('crossRate', () => {
  const usdNgn = parseRate('1500');
  const usdEur = parseRate('0.9');

  it('derives A→B from USD-pivoted quotes', () => {
    expect(formatRate(crossRate(RATE_SCALE, usdNgn))).toBe('1500.000000000000000000');
    expect(formatRate(crossRate(usdNgn, RATE_SCALE))).toBe('0.000666666666666666');
    expect(formatRate(crossRate(usdEur, usdNgn))).toBe('1666.666666666666666666');
  });

  it('is identity for the same currency', () => {
    expect(crossRate(usdNgn, usdNgn)).toBe(RATE_SCALE);
  });
});

describe('convert', () => {
  it('converts at the given rate', () => {
    const rate = parseRate('1500');
    expect(convert(parseAmount('10', 'USDx'), 'USDx', 'cNGN', rate)).toBe(
      parseAmount('15000', 'cNGN'),
    );
  });

  it('truncates rather than rounds up', () => {
    // 1 cNGN at 1/1500 USD = 0.000666666... USDx → 0.000666
    const rate = crossRate(parseRate('1500'), RATE_SCALE);
    expect(convert(parseAmount('1', 'cNGN'), 'cNGN', 'USDx', rate)).toBe(666n);
  });

  it('can produce zero for dust amounts', () => {
    const rate = crossRate(parseRate('1500'), RATE_SCALE);
    expect(convert(1n, 'cNGN', 'USDx', rate)).toBe(0n);
  });

  it('stays exact for very large amounts', () => {
    const amount = parseAmount('1000000000000000', 'cNGN'); // 1e15 cNGN
    const rate = crossRate(parseRate('1500'), RATE_SCALE);
    expect(convert(amount, 'cNGN', 'USDx', rate)).toBe(666_666_666_666_666_000n); // 666,666,666,666.666000 USDx
  });
});
