CREATE TYPE "public"."journal_type" AS ENUM('sale', 'sale_reversal');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('accounts_receivable', 'sales_revenue');--> statement-breakpoint
CREATE TYPE "public"."ledger_side" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"journal_type" "journal_type" NOT NULL,
	"order_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"side" "ledger_side" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" varchar(240) NOT NULL,
	"posted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_journal_account_unique" UNIQUE("journal_id","account"),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_cents" > 0),
	CONSTRAINT "ledger_entries_account_normal_side" CHECK ((
        ("ledger_entries"."journal_type" = 'sale'
          AND (
            ("ledger_entries"."account" = 'accounts_receivable' AND "ledger_entries"."side" = 'debit')
            OR ("ledger_entries"."account" = 'sales_revenue' AND "ledger_entries"."side" = 'credit')
          ))
        OR
        ("ledger_entries"."journal_type" = 'sale_reversal'
          AND (
            ("ledger_entries"."account" = 'accounts_receivable' AND "ledger_entries"."side" = 'credit')
            OR ("ledger_entries"."account" = 'sales_revenue' AND "ledger_entries"."side" = 'debit')
          ))
      ))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_at_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_id_idx" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_invoice_id_idx" ON "ledger_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_created_at_idx" ON "ledger_entries" USING btree ("created_at");