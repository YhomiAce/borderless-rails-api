import { customType } from 'drizzle-orm/pg-core';

/**
 * Integer amount in base units, stored as numeric(38,0) and surfaced as bigint.
 * numeric (not int8) avoids overflow for high-denomination currencies such as cNGN.
 */
export const money = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'numeric(38, 0)',
  fromDriver: (value) => BigInt(value),
  toDriver: (value) => value.toString(),
});

/** Exchange rate as an exact decimal string, numeric(38,18). */
export const rate = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(38, 18)',
});
