import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { customers } from "@/db/schema/customers";
import { orderStatus } from "@/db/schema/enums";
import { products } from "@/db/schema/inventory";
import { timestamps } from "@/db/schema/shared";
import { users } from "@/db/schema/users";

export const orderNumberSequence = pgSequence("order_number_seq", {
  startWith: 1000,
});

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: varchar("order_number", { length: 24 })
      .default(
        sql`'SO-' || lpad(nextval('order_number_seq'::regclass)::text, 6, '0')`,
      )
      .notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: orderStatus("status").default("draft").notNull(),
    version: integer("version").default(1).notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .default("USD")
      .notNull(),
    // Raw-SQL default: drizzle-kit cannot serialize BigInt literals.
    totalCents: bigint("total_cents", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    notes: text("notes"),
    cancellationReason: text("cancellation_reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    fulfilledBy: uuid("fulfilled_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("orders_order_number_unique").on(table.orderNumber),
    index("orders_customer_id_idx").on(table.customerId),
    index("orders_status_created_at_idx").on(table.status, table.createdAt),
    index("orders_created_by_idx").on(table.createdBy),
    check("orders_version_positive", sql`${table.version} > 0`),
    check("orders_total_nonnegative", sql`${table.totalCents} >= 0`),
    check("orders_currency_usd", sql`${table.currencyCode} = 'USD'`),
  ],
);

export const orderLineItems = pgTable(
  "order_line_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productSku: varchar("product_sku", { length: 64 }).notNull(),
    productName: varchar("product_name", { length: 160 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
    lineTotalCents: bigint("line_total_cents", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("order_line_items_order_product_unique").on(
      table.orderId,
      table.productId,
    ),
    index("order_line_items_product_id_idx").on(table.productId),
    check("order_line_items_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "order_line_items_price_nonnegative",
      sql`${table.unitPriceCents} >= 0`,
    ),
    check(
      "order_line_items_total_matches",
      sql`${table.lineTotalCents} = ${table.quantity} * ${table.unitPriceCents}`,
    ),
  ],
);
