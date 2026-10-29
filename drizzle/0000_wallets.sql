CREATE TYPE "public"."account_kind" AS ENUM('USER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx');--> statement-breakpoint
CREATE TABLE "balances" (
	"wallet_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"kind" "account_kind" NOT NULL,
	"amount" numeric(38, 0) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balances_pkey" PRIMARY KEY("wallet_id","currency"),
	CONSTRAINT "balances_non_negative_check" CHECK ("balances"."kind" = 'SYSTEM' OR "balances"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "account_kind" DEFAULT 'USER' NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_email_key" UNIQUE("email"),
	CONSTRAINT "wallets_phone_key" UNIQUE("phone"),
	CONSTRAINT "wallets_id_kind_key" UNIQUE("id","kind"),
	CONSTRAINT "wallets_identifier_check" CHECK ("wallets"."kind" = 'SYSTEM' OR "wallets"."email" IS NOT NULL OR "wallets"."phone" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_wallet_fk" FOREIGN KEY ("wallet_id","kind") REFERENCES "public"."wallets"("id","kind") ON DELETE cascade ON UPDATE no action;