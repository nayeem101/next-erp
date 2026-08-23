CREATE TYPE "public"."stock_movement_type" AS ENUM('opening', 'adjustment', 'sale', 'sale_reversal');--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid,
	"type" "stock_movement_type" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"resulting_stock" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("stock_movements"."quantity_delta" <> 0),
	CONSTRAINT "stock_movements_result_nonnegative" CHECK ("stock_movements"."resulting_stock" >= 0),
	CONSTRAINT "stock_movements_order_reference" CHECK ((
        ("stock_movements"."type" IN ('sale', 'sale_reversal') AND "stock_movements"."order_id" IS NOT NULL)
        OR
        ("stock_movements"."type" IN ('opening', 'adjustment') AND "stock_movements"."order_id" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_product_created_at_idx" ON "stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements" USING btree ("order_id");