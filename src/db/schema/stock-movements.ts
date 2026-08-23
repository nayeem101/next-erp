import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { stockMovementType } from "@/db/schema/enums";
import { products } from "@/db/schema/inventory";
import { orders } from "@/db/schema/orders";
import { createdAtOnly } from "@/db/schema/shared";
import { users } from "@/db/schema/users";

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    type: stockMovementType("type").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    resultingStock: integer("resulting_stock").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...createdAtOnly,
  },
  (table) => [
    index("stock_movements_product_created_at_idx").on(
      table.productId,
      table.createdAt,
    ),
    index("stock_movements_order_id_idx").on(table.orderId),
    check("stock_movements_quantity_nonzero", sql`${table.quantityDelta} <> 0`),
    check(
      "stock_movements_result_nonnegative",
      sql`${table.resultingStock} >= 0`,
    ),
    check(
      "stock_movements_order_reference",
      sql`(
        (${table.type} IN ('sale', 'sale_reversal') AND ${table.orderId} IS NOT NULL)
        OR
        (${table.type} IN ('opening', 'adjustment') AND ${table.orderId} IS NULL)
      )`,
    ),
  ],
);
