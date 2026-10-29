CREATE TABLE "fx_rates" (
	"currency" "currency" PRIMARY KEY NOT NULL,
	"usd_rate" numeric(38, 18) NOT NULL,
	"source" text NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"provider_updated_at" timestamp with time zone
);
