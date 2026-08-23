CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'void');--> statement-breakpoint
CREATE SEQUENCE "public"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1000 CACHE 1;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(24) DEFAULT 'INV-' || lpad(nextval('invoice_number_seq'::regclass)::text, 6, '0') NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"currency_code" varchar(3) DEFAULT 'USD' NOT NULL,
	"seller_snapshot" jsonb NOT NULL,
	"bill_to_snapshot" jsonb NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "invoices_subtotal_positive" CHECK ("invoices"."subtotal_cents" > 0),
	CONSTRAINT "invoices_total_positive" CHECK ("invoices"."total_cents" > 0),
	CONSTRAINT "invoices_total_matches_subtotal" CHECK ("invoices"."total_cents" = "invoices"."subtotal_cents"),
	CONSTRAINT "invoices_currency_usd" CHECK ("invoices"."currency_code" = 'USD'),
	CONSTRAINT "invoices_seller_snapshot_shape" CHECK (jsonb_typeof("invoices"."seller_snapshot") = 'object'
        AND "invoices"."seller_snapshot" ?& ARRAY[
    'name', 'email', 'addressLine1', 'city', 'postalCode', 'countryCode'
  ]),
	CONSTRAINT "invoices_bill_to_snapshot_shape" CHECK (jsonb_typeof("invoices"."bill_to_snapshot") = 'object'
        AND "invoices"."bill_to_snapshot" ?& ARRAY[
    'name', 'email', 'addressLine1', 'city', 'postalCode', 'countryCode'
  ])
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_status_issued_at_idx" ON "invoices" USING btree ("status","issued_at");