-- Double-entry contra accounts. IDs are fixed and mirrored in src/database/system-accounts.ts.
-- MINT:    source of simulated deposits (its balance goes negative = total issued).
-- FX_POOL: liquidity pool that takes the source currency and pays out the destination currency on swaps.
INSERT INTO "wallets" ("id", "kind") VALUES
  ('00000000-0000-0000-0000-000000000001', 'SYSTEM'),
  ('00000000-0000-0000-0000-000000000002', 'SYSTEM');
--> statement-breakpoint
INSERT INTO "balances" ("wallet_id", "currency", "kind")
SELECT w.id, c.currency, 'SYSTEM'
FROM (VALUES ('00000000-0000-0000-0000-000000000001'::uuid), ('00000000-0000-0000-0000-000000000002'::uuid)) AS w(id)
CROSS JOIN unnest(enum_range(NULL::"currency")) AS c(currency);
