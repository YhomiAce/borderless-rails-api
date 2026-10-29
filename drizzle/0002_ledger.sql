CREATE TYPE "public"."transaction_status" AS ENUM('COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('DEPOSIT', 'SWAP', 'TRANSFER');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" numeric(38, 0) NOT NULL,
	"balance_after" numeric(38, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_non_zero_check" CHECK ("ledger_entries"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'COMPLETED' NOT NULL,
	"wallet_id" uuid NOT NULL,
	"counterparty_wallet_id" uuid,
	"source_currency" "currency" NOT NULL,
	"source_amount" numeric(38, 0) NOT NULL,
	"destination_currency" "currency" NOT NULL,
	"destination_amount" numeric(38, 0) NOT NULL,
	"rate" numeric(38, 18) NOT NULL,
	"rate_source" text NOT NULL,
	"rate_timestamp" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amounts_positive_check" CHECK ("transactions"."source_amount" > 0 AND "transactions"."destination_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_counterparty_wallet_id_wallets_id_fk" FOREIGN KEY ("counterparty_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_wallet_currency_idx" ON "ledger_entries" USING btree ("wallet_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_wallet_idempotency_key" ON "transactions" USING btree ("wallet_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "transactions_wallet_history_idx" ON "transactions" USING btree ("wallet_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_counterparty_history_idx" ON "transactions" USING btree ("counterparty_wallet_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);