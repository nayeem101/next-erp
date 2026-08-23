import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { timestamps } from "@/db/schema/shared";
import { users } from "@/db/schema/users";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("categories_name_lower_unique").on(sql`lower(${table.name})`),
    unique("categories_slug_unique").on(table.slug),
    index("categories_active_idx").on(table.isActive),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    sku: varchar("sku", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
    stockOnHand: integer("stock_on_hand").default(0).notNull(),
    reorderLevel: integer("reorder_level").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("products_sku_upper_unique").on(sql`upper(${table.sku})`),
    index("products_category_id_idx").on(table.categoryId),
    index("products_name_idx").on(table.name),
    index("products_active_idx").on(table.isActive),
    index("products_low_stock_idx")
      .on(table.stockOnHand, table.reorderLevel)
      .where(sql`${table.isActive} = true`),
    check("products_price_positive", sql`${table.unitPriceCents} > 0`),
    check("products_stock_nonnegative", sql`${table.stockOnHand} >= 0`),
    check(
      "products_reorder_level_nonnegative",
      sql`${table.reorderLevel} >= 0`,
    ),
  ],
);
